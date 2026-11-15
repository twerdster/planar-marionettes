/** Local, worker-based MediaPipe inference. Original Puppify source was not recovered. */
export interface NormalizedLandmark {
  x: number;
  y: number;
  z: number;
  visibility: number;
  presence?: number;
}

export interface VisionMask { data: Float32Array; width: number; height: number }
export interface VisionResult {
  width: number;
  height: number;
  landmarks: NormalizedLandmark[];
  mask?: VisionMask;
  inferenceMs: number;
  delegate: 'GPU' | 'CPU';
}
export interface VisionProgress {
  stage: 'loading' | 'fallback' | 'ready' | 'detecting' | 'error';
  message: string;
}
export interface VisionOptions {
  onProgress?: (progress: VisionProgress) => void;
  /** Same-origin directory containing the versioned, vendored model and WASM. */
  assetBase?: string;
  /** CPU is useful for reproducible diagnostics; GPU is attempted by default. */
  delegate?: 'GPU' | 'CPU';
}
export interface AnalyzeOptions {
  withMask: boolean;
  /** Milliseconds in a video; omission selects independent IMAGE inference. */
  timestamp?: number;
  signal?: AbortSignal;
}

type Source = ImageBitmap | HTMLCanvasElement | OffscreenCanvas;
type Pending = {
  id: number;
  resolve: (value: VisionResult | null) => void;
  reject: (reason: Error) => void;
  cleanup: () => void;
};

const abortError = () => new DOMException('Inference cancelled.', 'AbortError');

/** One inference at a time; callers should throttle video rather than queue frames. */
export class VisionClient {
  private worker?: Worker;
  private initialization?: Promise<void>;
  private readyResolve?: () => void;
  private readyReject?: (error: Error) => void;
  private pending?: Pending;
  private sequence = 0;
  private closed = false;
  private preparing = false;

  constructor(private readonly options: VisionOptions = {}) {}

  /** A fatal worker/load failure requires a fresh client on the next user action. */
  get isClosed(): boolean { return this.closed; }

  init(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Vision client is closed.'));
    if (this.initialization) return this.initialization;
    this.initialization = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
      try {
        if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
          throw new Error('This browser needs Web Workers and OffscreenCanvas for local pose detection.');
        }
        this.worker = new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module' });
        this.worker.onmessage = ({ data }) => {
          if (data.type === 'progress') this.options.onProgress?.(data.progress);
          if (data.type === 'ready') {
            this.readyResolve?.();
            this.readyResolve = this.readyReject = undefined;
          }
          if (data.type === 'fatal') this.fail(new Error(data.message));
          if (data.type === 'result' || data.type === 'error') {
            const pending = this.pending;
            if (!pending || data.id !== pending.id) return;
            this.pending = undefined;
            pending.cleanup();
            if (data.type === 'error') pending.reject(new Error(data.message));
            else pending.resolve(data.result);
          }
        };
        this.worker.onerror = (event) => this.fail(new Error(event.message || 'Pose worker failed.'));
        this.worker.onmessageerror = () => this.fail(new Error('Could not read the pose worker response.'));
        const viteBase = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL ?? './';
        const base = new URL(this.options.assetBase ?? `${viteBase}vendor/vision/`, document.baseURI);
        if (base.origin !== location.origin) throw new Error('Vision assets must be served from this site.');
        this.worker.postMessage({ type: 'init', assetBase: base.href, delegate: this.options.delegate ?? 'GPU' });
      } catch (error) {
        this.fail(error instanceof Error ? error : new Error(String(error)));
      }
    });
    return this.initialization;
  }

  ready(): Promise<void> { return this.init(); }

  async analyze(source: Source, options: AnalyzeOptions): Promise<VisionResult | null> {
    if (options.signal?.aborted) throw abortError();
    if (this.pending || this.preparing) throw new Error('Pose inference is busy; wait before submitting another frame.');
    if (options.timestamp !== undefined && (!Number.isFinite(options.timestamp) || options.timestamp < 0)) {
      throw new Error('Video timestamp must be a finite, non-negative number of milliseconds.');
    }
    this.preparing = true;
    let bitmap: ImageBitmap | undefined;
    try {
      await this.init();
      if (options.signal?.aborted) throw abortError();
      if (this.closed) throw new Error('Vision client is closed.');
      // Clone: the caller can keep using its photograph/canvas after inference.
      bitmap = await createImageBitmap(source);
      if (bitmap.width < 2 || bitmap.height < 2) throw new Error('Image has no usable pixels.');
      if (options.signal?.aborted) throw abortError();
      if (this.closed) throw new Error('Vision client is closed.');
      const id = ++this.sequence;
      return await new Promise<VisionResult | null>((resolve, reject) => {
        // Native inference cannot be interrupted halfway through. Cancellation
        // rejects this request immediately while its worker frame drains; no
        // second frame is accepted until the matching response releases it.
        let cancelled = false;
        const abort = () => { cancelled = true; reject(abortError()); };
        options.signal?.addEventListener('abort', abort, { once: true });
        this.pending = {
          id,
          resolve: (result) => { if (!cancelled) resolve(result); },
          reject: (error) => { if (!cancelled) reject(error); },
          cleanup: () => options.signal?.removeEventListener('abort', abort),
        };
        try {
          this.worker!.postMessage({ type: 'analyze', id, bitmap, withMask: options.withMask, timestamp: options.timestamp }, [bitmap!]);
          bitmap = undefined;
        } catch (error) {
          this.pending.cleanup();
          this.pending = undefined;
          reject(error);
        }
      });
    } finally {
      this.preparing = false;
      bitmap?.close();
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    // Termination releases worker-owned bitmaps, masks and WASM memory, including
    // an in-flight synchronous inference. It is the hard cancellation boundary.
    this.worker?.terminate();
    this.worker = undefined;
    this.readyReject?.(abortError());
    this.readyResolve = this.readyReject = undefined;
    this.pending?.cleanup();
    this.pending?.reject(abortError());
    this.pending = undefined;
  }

  private fail(error: Error): void {
    this.options.onProgress?.({ stage: 'error', message: error.message });
    this.readyReject?.(error);
    this.readyResolve = this.readyReject = undefined;
    this.pending?.cleanup();
    this.pending?.reject(error);
    this.pending = undefined;
    this.worker?.terminate();
    this.worker = undefined;
    this.closed = true;
  }
}

export function createVision(options: VisionOptions = {}): VisionClient { return new VisionClient(options); }
