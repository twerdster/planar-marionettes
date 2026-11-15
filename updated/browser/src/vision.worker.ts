/// <reference lib="webworker" />
import type { PoseLandmarker, PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import type { VisionResult, VisionProgress } from './vision';

const scope = self as unknown as DedicatedWorkerGlobalScope;

// The pinned SDK contains usage-logging code. Block external transport before
// importing it. Only same-origin, self-hosted model/WASM fetches are permitted.
const localURL = (input: string | URL | Request) => {
  const url = new URL(input instanceof Request ? input.url : String(input), scope.location.href);
  if (url.origin !== scope.location.origin) throw new DOMException('External network requests are disabled in the pose worker.', 'SecurityError');
  return url;
};
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input, init) => {
  try { localURL(input); } catch (error) { return Promise.reject(error); }
  return originalFetch(input, init);
};
const originalOpen = XMLHttpRequest.prototype.open;
const originalSend = XMLHttpRequest.prototype.send;
const blockedXHR = new WeakSet<XMLHttpRequest>();
XMLHttpRequest.prototype.open = function (method: string, url: string | URL, async: boolean = true, username?: string | null, password?: string | null) {
  try { localURL(url); }
  catch {
    // Keep the XHR state machine valid for SDK setRequestHeader calls, but
    // never send this request. An asynchronous error lets its logger stop
    // cleanly rather than throwing from a periodic timer.
    blockedXHR.add(this);
    return originalOpen.call(this, 'GET', scope.location.href, true);
  }
  blockedXHR.delete(this);
  return originalOpen.call(this, method, url, async, username, password);
};
XMLHttpRequest.prototype.send = function (body?: XMLHttpRequestBodyInit | null) {
  if (blockedXHR.has(this)) {
    queueMicrotask(() => this.dispatchEvent(new ProgressEvent('error')));
    return;
  }
  return originalSend.call(this, body);
};

let landmarker: PoseLandmarker | undefined;
let runtime: typeof import('@mediapipe/tasks-vision');
let assetBase: string;
let delegate: 'GPU' | 'CPU' = 'GPU';
let mode: 'IMAGE' | 'VIDEO' = 'IMAGE';
let masks = true;
let lastTimestamp = 0;
let busy = false;

const progress = (stage: VisionProgress['stage'], message: string) => scope.postMessage({ type: 'progress', progress: { stage, message } });
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

async function initialize(nextDelegate: 'GPU' | 'CPU'): Promise<void> {
  landmarker?.close();
  landmarker = undefined;
  delegate = nextDelegate;
  const files = await runtime.FilesetResolver.forVisionTasks(`${assetBase}wasm`, true);
  landmarker = await runtime.PoseLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: `${assetBase}pose_landmarker_full.task`, delegate },
    canvas: new OffscreenCanvas(1, 1),
    runningMode: mode,
    numPoses: 1,
    outputSegmentationMasks: masks,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
}

function softwareGPU(): boolean {
  const canvas = new OffscreenCanvas(1, 1);
  const gl = canvas.getContext('webgl2');
  if (!gl) return false; // Normal GPU initialization will report/fallback.
  const extension = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = extension ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL)) : '';
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return /swiftshader|llvmpipe|software rasterizer/i.test(renderer);
}

function detect(bitmap: ImageBitmap, timestamp?: number): VisionResult | null {
  const start = performance.now();
  let result: PoseLandmarkerResult | undefined;
  try {
    result = timestamp === undefined ? landmarker!.detect(bitmap) : landmarker!.detectForVideo(bitmap, timestamp);
    const points = result.landmarks[0];
    if (!points || points.length !== 33) return null;
    const mask = result.segmentationMasks?.[0];
    return {
      width: bitmap.width, height: bitmap.height,
      landmarks: points.map((point) => ({ x: point.x, y: point.y, z: point.z, visibility: point.visibility ?? 0, presence: (point as typeof point & { presence?: number }).presence })),
      mask: mask ? { width: mask.width, height: mask.height, data: new Float32Array(mask.getAsFloat32Array()) } : undefined,
      inferenceMs: performance.now() - start,
      delegate,
    };
  } finally {
    result?.close();
  }
}

scope.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      assetBase = new URL(data.assetBase).href;
      localURL(assetBase);
      progress('loading', 'Loading the local pose model and WebAssembly runtime…');
      runtime = await import('@mediapipe/tasks-vision');
      let requested: 'GPU' | 'CPU' = data.delegate;
      if (requested === 'GPU' && softwareGPU()) {
        requested = 'CPU';
        progress('fallback', 'A software GPU renderer was detected; using CPU inference.');
      }
      try { await initialize(requested); }
      catch (error) {
        if (requested !== 'GPU') throw error;
        progress('fallback', `GPU initialization was unavailable; loading the CPU implementation. (${message(error)})`);
        await initialize('CPU');
      }
      progress('ready', `Pose model ready (${delegate}, processing stays in this browser).`);
      scope.postMessage({ type: 'ready' });
    } catch (error) { scope.postMessage({ type: 'fatal', message: message(error) }); }
    return;
  }
  if (data.type !== 'analyze') return;
  const bitmap: ImageBitmap = data.bitmap;
  if (busy || !landmarker) {
    bitmap.close();
    scope.postMessage({ type: 'error', id: data.id, message: busy ? 'Pose worker is busy.' : 'Pose model is not ready.' });
    return;
  }
  busy = true;
  try {
    progress('detecting', data.timestamp === undefined ? 'Estimating joints and the person mask…' : 'Estimating the next video pose…');
    const nextMode = data.timestamp === undefined ? 'IMAGE' : 'VIDEO';
    if (mode !== nextMode || masks !== data.withMask) {
      mode = nextMode;
      masks = data.withMask;
      await landmarker.setOptions({ runningMode: mode, outputSegmentationMasks: masks });
    }
    // Different clips can restart at 0. The model itself requires increasing
    // timestamps, so preserve their order without exposing its internal clock.
    const timestamp = data.timestamp === undefined ? undefined : Math.max(data.timestamp, lastTimestamp + 1);
    if (timestamp !== undefined) lastTimestamp = timestamp;
    let result: VisionResult | null;
    try { result = detect(bitmap, timestamp); }
    catch (error) {
      if (delegate !== 'GPU') throw error;
      progress('fallback', 'GPU inference failed; retrying this frame on the CPU.');
      await initialize('CPU');
      result = detect(bitmap, timestamp);
    }
    scope.postMessage({ type: 'result', id: data.id, result }, result?.mask ? [result.mask.data.buffer] : []);
  } catch (error) {
    // Failed CPU reinitialization clears the native task. This is a fatal client
    // state, so the page can recreate it rather than reusing an empty worker.
    if (!landmarker) scope.postMessage({ type: 'fatal', message: message(error) });
    else scope.postMessage({ type: 'error', id: data.id, message: message(error) });
  }
  finally { bitmap.close(); busy = false; }
};
