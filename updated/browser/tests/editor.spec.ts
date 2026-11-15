import { expect, test, type Page, type BrowserContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';

type Point = { x: number; y: number; confidence?: number };
type Pose = Record<string, Point>;
type RuntimeEvidence = { external: string[]; errors: string[]; resources: string[] };
const evidence = new WeakMap<Page, RuntimeEvidence>();

// Observe genuine Worker messages without replacing inference, results or assets.
async function observeInference(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = { workers: 0, terminated: 0, results: [] as any[], progress: [] as any[], fatalErrors: [] as string[] };
    (window as any).__puppifyQA = state;
    const NativeWorker = window.Worker;
    class ObservedWorker extends NativeWorker {
      private submitted = new Map<number, { timestamp?: number; withMask: boolean }>();
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        state.workers++;
        this.addEventListener('message', ({ data }) => {
          if (data.type === 'progress') state.progress.push(data.progress);
          if (data.type === 'fatal') state.fatalErrors.push(data.message);
          if (data.type !== 'result' && data.type !== 'error') return;
          const request = this.submitted.get(data.id);
          this.submitted.delete(data.id);
          const result = data.result;
          let foreground = 0;
          if (result?.mask) for (const value of result.mask.data) if (value > 0.5) foreground++;
          state.results.push({
            id: data.id, request, error: data.type === 'error' ? data.message : undefined,
            detected: !!result, delegate: result?.delegate, inferenceMs: result?.inferenceMs,
            width: result?.width, height: result?.height,
            landmarks: result?.landmarks, foreground,
            maskPixels: result?.mask?.data.length ?? 0,
          });
        });
      }
      postMessage(message: any, transferOrOptions?: Transferable[] | StructuredSerializeOptions): void {
        if (message?.type === 'analyze') this.submitted.set(message.id, {
          timestamp: message.timestamp, withMask: message.withMask,
        });
        super.postMessage(message, transferOrOptions as Transferable[]);
      }
      terminate(): void { state.terminated++; super.terminate(); }
    }
    Object.defineProperty(window, 'Worker', { value: ObservedWorker, writable: true, configurable: true });
  });
}

test.beforeEach(async ({ page, context, baseURL }) => {
  const recorded: RuntimeEvidence = { external: [], errors: [], resources: [] };
  evidence.set(page, recorded);
  const origin = new URL(baseURL!).origin;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== origin) {
      recorded.external.push(url.href);
      await route.abort('blockedbyclient');
    } else await route.continue();
  });
  context.on('response', response => {
    if (/\.task(?:\?|$)|\.wasm(?:\?|$)/.test(response.url()) && response.ok()) {
      recorded.resources.push(response.url());
    }
  });
  page.on('pageerror', error => recorded.errors.push(error.message));
  await observeInference(page);
  await page.goto('/');
});

test.afterEach(async ({ page }, info) => {
  const recorded = evidence.get(page)!;
  const runtime = await page.evaluate(() => (window as any).__puppifyQA).catch(() => null);
  const environment = {
    browserVersion: page.context().browser()?.version(),
    userAgent: await page.evaluate(() => navigator.userAgent).catch(() => null),
    viewport: page.viewportSize(),
    nodeVersion: process.version,
    platform: process.platform,
  };
  await info.attach('local-runtime-evidence', {
    body: JSON.stringify({ browserProject: info.project.name, environment, ...recorded, runtime }, null, 2),
    contentType: 'application/json',
  });
  if (info.status === info.expectedStatus) {
    expect(recorded.external, 'No runtime request may leave the local application origin').toEqual([]);
    expect(recorded.errors, 'No uncaught page errors').toEqual([]);
  }
});

async function actualResults(page: Page): Promise<any[]> {
  return page.evaluate(() => (window as any).__puppifyQA.results);
}

async function readPose(page: Page, selector = '#puppet-canvas'): Promise<Pose> {
  return page.locator(selector).evaluate(canvas => JSON.parse((canvas as HTMLElement).dataset.pose ?? '{}'));
}

function poseDistance(first: Pose, second: Pose): number {
  return Object.keys(first).reduce((sum, name) => sum + Math.hypot(
    first[name].x - (second[name]?.x ?? first[name].x),
    first[name].y - (second[name]?.y ?? first[name].y),
  ), 0);
}

async function canvasStats(page: Page, selector = '#puppet-canvas') {
  return page.locator(selector).evaluate(element => {
    const canvas = element as HTMLCanvasElement;
    const rgba = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let opaque = 0, transparent = 0, hash = 2166136261;
    const colors = new Set<number>();
    for (let index = 0; index < rgba.length; index += 4) {
      if (rgba[index + 3] > 128) {
        opaque++;
        colors.add((rgba[index] >> 3) * 1024 + (rgba[index + 1] >> 3) * 32 + (rgba[index + 2] >> 3));
      } else if (rgba[index + 3] === 0) transparent++;
      hash = Math.imul(hash ^ rgba[index], 16777619) >>> 0;
      hash = Math.imul(hash ^ rgba[index + 1] ^ rgba[index + 2] ^ rgba[index + 3], 16777619) >>> 0;
    }
    return { width: canvas.width, height: canvas.height, opaque, transparent, colors: colors.size, hash };
  });
}

async function loadExamplePhoto(page: Page): Promise<void> {
  await page.locator('#sample-photo').click();
  await expect(page.locator('#photo-canvas')).toHaveAttribute('data-state', 'detected');
  await expect(page.locator('#build-puppet')).toBeEnabled();
  const result = (await actualResults(page)).find(item => item.request?.withMask && item.detected);
  expect(result, 'The real worker must return photo inference, not a preset pose').toBeTruthy();
  expect(result.landmarks).toHaveLength(33);
  expect(result.maskPixels).toBeGreaterThan(1000);
  expect(result.foreground).toBeGreaterThan(500);
  expect(result.foreground).toBeLessThan(result.maskPixels * 0.75);
  expect(result.inferenceMs).toBeGreaterThan(0);
  expect(['CPU', 'GPU']).toContain(result.delegate);
}

async function buildExample(page: Page): Promise<void> {
  await loadExamplePhoto(page);
  await page.locator('#build-puppet').click();
  await expect(page.locator('#puppet-canvas')).toHaveAttribute('data-state', 'ready');
  await expect(page.locator('#stage-empty')).toBeHidden();
  await expect(page.locator('#download-png')).toBeEnabled();
  await expect.poll(async () => (await canvasStats(page)).opaque).toBeGreaterThan(1000);
  const stats = await canvasStats(page);
  expect(stats.transparent).toBeGreaterThan(1000);
  expect(stats.colors, 'The stage contains photographic pixels, not just skeleton dots').toBeGreaterThan(100);
  const parts = await page.locator('#puppet-canvas').evaluate(canvas => JSON.parse((canvas as HTMLElement).dataset.partSummary ?? '[]'));
  expect(parts).toHaveLength(10);
  expect(parts.filter((part: any) => part.pixels > 10).length).toBeGreaterThanOrEqual(8);
  expect(evidence.get(page)!.resources.some(url => url.includes('pose_landmarker_full.task'))).toBeTruthy();
  expect(evidence.get(page)!.resources.some(url => url.endsWith('.wasm'))).toBeTruthy();
}

async function dragJoint(page: Page, context: BrowserContext, selector: string, joint: string, dx: number, dy: number, touch: boolean): Promise<void> {
  const canvas = page.locator(selector);
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  const point = await canvas.evaluate((element, name) => {
    const positions = JSON.parse((element as HTMLElement).dataset.screenJoints ?? '{}');
    return positions[name];
  }, joint);
  expect(point).toBeTruthy();
  const x = box.x + point.x, y = box.y + point.y;
  if (touch) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 6; step++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove', touchPoints: [{ x: x + dx * step / 6, y: y + dy * step / 6 }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(x, y); await page.mouse.down();
    await page.mouse.move(x + dx, y + dy, { steps: 6 }); await page.mouse.up();
  }
}

async function blankImage(page: Page): Promise<Buffer> {
  const encoded = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#888'; ctx.fillRect(0, 0, 640, 480);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(encoded, 'base64');
}

test('real photo creates photographic cutouts; pointer or touch posing resets and exports a transparent PNG', async ({ page, context, isMobile }, info) => {
  await buildExample(page);
  const original = await readPose(page);
  const originalPixels = await canvasStats(page);
  await dragJoint(page, context, '#puppet-canvas', 'leftWrist', -35, 55, isMobile);
  await expect.poll(async () => poseDistance(original, await readPose(page))).toBeGreaterThan(0.01);
  await expect.poll(async () => (await canvasStats(page)).hash).not.toBe(originalPixels.hash);
  await page.locator('#reset-pose').click();
  await expect.poll(async () => poseDistance(original, await readPose(page))).toBeLessThan(0.00001);
  await page.locator('#show-joints').uncheck();
  await expect.poll(async () => (await canvasStats(page)).hash).not.toBe(originalPixels.hash);
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#download-png').click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('puppify-puppet.png');
  const path = info.outputPath('exported-puppet.png'); await download.saveAs(path);
  const png = await readFile(path);
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(png.length).toBeGreaterThan(10_000);
  expect(png.readUInt32BE(16)).toBe(1200); expect(png.readUInt32BE(20)).toBe(1400);
  const image = await page.evaluate(async bytes => {
    const bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
    const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(bitmap, 0, 0); bitmap.close();
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let transparent = 0, visible = 0;
    for (let i = 3; i < rgba.length; i += 4) { if (!rgba[i]) transparent++; if (rgba[i] > 128) visible++; }
    return { transparent, visible };
  }, [...png]);
  expect(image.transparent).toBeGreaterThan(100_000); expect(image.visible).toBeGreaterThan(1000);
  await expect(page.locator('#example-credit')).toContainText('Taco Fleur');
  await expect(page.locator('#example-credit a[href="https://creativecommons.org/licenses/by-sa/4.0/"]')).toBeVisible();
});

test('reference-joint correction and mask setting are applied when rebuilding', async ({ page, context, isMobile }, info) => {
  await buildExample(page);
  const before = await readPose(page, '#photo-canvas');
  await page.locator('#adjust-joints').click();
  await expect(page.locator('#adjust-joints')).toHaveAttribute('aria-pressed', 'true');
  await dragJoint(page, context, '#photo-canvas', 'leftAnkle', 7, -8, isMobile);
  await expect.poll(async () => poseDistance(before, await readPose(page, '#photo-canvas'))).toBeGreaterThan(0.01);
  const corrected = await readPose(page, '#photo-canvas');
  await page.locator('#build-puppet').click();
  await expect(page.locator('#status-text')).toContainText('Puppet ready');
  await expect.poll(async () => poseDistance(corrected, await readPose(page))).toBeLessThan(0.00001);
  const foregroundBefore = Number(await page.locator('#puppet-canvas').getAttribute('data-foreground-pixels'));
  expect(foregroundBefore).toBeGreaterThan(1000);
  await page.locator('.source-options summary').click();
  await page.locator('#mask-threshold').fill('0.60');
  await expect(page.locator('#threshold-value')).toHaveText('0.60');
  await page.locator('#build-puppet').click();
  await expect(page.locator('#status-text')).toContainText('Puppet ready');
  await expect.poll(async () => poseDistance(corrected, await readPose(page))).toBeLessThan(0.00001);
  // The corrected reference is fixed between these builds: only the threshold changes.
  await expect.poll(async () => Number(await page.locator('#puppet-canvas').getAttribute('data-foreground-pixels'))).toBeLessThan(foregroundBefore);
  const foregroundAfter = Number(await page.locator('#puppet-canvas').getAttribute('data-foreground-pixels'));
  await info.attach('threshold-foreground-evidence', {
    body: JSON.stringify({ thresholdBefore: 0.5, foregroundBefore, thresholdAfter: 0.6, foregroundAfter }),
    contentType: 'application/json',
  });
  await expect(page.locator('#adjust-joints')).toHaveAttribute('aria-pressed', 'false');
  expect((await canvasStats(page)).opaque).toBeGreaterThan(1000);
});

test('real example video advances and actual inferred poses drive the cutout, then reset stops motion', async ({ page }) => {
  // Exercise the public one-click path, including its automatic photo inference/build.
  await page.locator('#sample-video').click();
  await expect(page.locator('#photo-canvas')).toHaveAttribute('data-state', 'detected');
  await expect(page.locator('#puppet-canvas')).toHaveAttribute('data-state', 'ready');
  const reference = await readPose(page, '#photo-canvas');
  expect((await actualResults(page)).some(item => item.request?.withMask && item.detected && item.maskPixels > 1000)).toBeTruthy();
  await expect(page.locator('#motion-video')).toHaveJSProperty('paused', false);
  await expect.poll(async () => (await actualResults(page)).filter(item => item.request?.withMask === false && item.detected).length).toBeGreaterThanOrEqual(3);
  await expect.poll(async () => poseDistance(reference, await readPose(page))).toBeGreaterThan(0.03);
  const currentTime = await page.locator('#motion-video').evaluate(video => (video as HTMLVideoElement).currentTime);
  await expect.poll(() => page.locator('#motion-video').evaluate(video => (video as HTMLVideoElement).currentTime)).not.toBe(currentTime);
  expect((await actualResults(page)).filter(item => item.request?.withMask === false).every(item => item.request.timestamp > 0)).toBeTruthy();
  await page.locator('#mirror-motion').check();
  await expect(page.locator('#motion-video')).toHaveCSS('transform', 'matrix(-1, 0, 0, 1, 0, 0)');
  await page.locator('#reset-pose').click();
  await expect(page.locator('#motion-video')).toHaveJSProperty('paused', true);
  await expect.poll(async () => poseDistance(reference, await readPose(page))).toBeLessThan(0.00001);
  const stopped = await readPose(page);
  // Check settled reset stability; this does not force an inference to be in flight.
  await page.waitForTimeout(500);
  expect(poseDistance(stopped, await readPose(page))).toBeLessThan(0.00001);
  // A genuine decoded video frame becomes a new photo and is inferred again.
  await page.locator('#motion-video').evaluate(async video => {
    const element = video as HTMLVideoElement;
    const seeked = new Promise<void>(resolve => element.addEventListener('seeked', () => resolve(), { once: true }));
    element.currentTime = 1.27; await seeked;
  });
  const photosBefore = (await actualResults(page)).filter(item => item.request?.withMask && item.detected).length;
  await page.locator('#use-video-frame').click();
  await expect(page.locator('#photo-canvas')).toHaveAttribute('data-state', 'detected');
  await expect.poll(async () => (await actualResults(page)).filter(item => item.request?.withMask && item.detected).length).toBeGreaterThan(photosBefore);
  await page.locator('#build-puppet').click();
  await expect(page.locator('#puppet-canvas')).toHaveAttribute('data-state', 'ready');
});

test('bad image bytes and a genuine no-person inference fail clearly and the next real photo recovers', async ({ page }) => {
  await buildExample(page);
  await page.locator('#photo-file').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
  await expect(page.locator('#status-box')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#build-puppet')).toBeDisabled();
  await expect(page.locator('#puppet-canvas')).toHaveAttribute('data-state', 'empty');
  await expect(page.locator('#stage-empty')).toBeVisible();
  await expect.poll(async () => (await canvasStats(page)).opaque).toBe(0);
  await page.locator('#photo-file').setInputFiles({ name: 'blank-negative-control.png', mimeType: 'image/png', buffer: await blankImage(page) });
  await expect(page.locator('#photo-canvas')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#status-text')).toContainText('No full-body person');
  expect((await actualResults(page)).some(item => item.request?.withMask && !item.detected && !item.error)).toBeTruthy();
  await expect(page.locator('#download-png')).toBeDisabled();
  await buildExample(page);
});

test('replacing a photo during actual model loading cancels the old worker and cannot restore its stale puppet', async ({ page, context }) => {
  let release!: () => void; let requested = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await context.route('**/vendor/vision/pose_landmarker_full.task', async route => {
    requested = true; await gate; await route.continue().catch(() => {});
  });
  try {
    await page.locator('#sample-photo').click();
    await expect.poll(() => requested).toBeTruthy();
    await page.locator('#photo-file').setInputFiles({ name: 'replacement-blank.png', mimeType: 'image/png', buffer: await blankImage(page) });
    release();
    await expect(page.locator('#photo-canvas')).toHaveAttribute('data-state', 'error');
    await expect(page.locator('#status-text')).toContainText('No full-body person');
    expect(await page.evaluate(() => (window as any).__puppifyQA.terminated)).toBeGreaterThanOrEqual(1);
    await expect(page.locator('#build-puppet')).toBeDisabled();
    await expect(page.locator('#download-png')).toBeDisabled();
    await page.waitForTimeout(500);
    await expect(page.locator('#photo-canvas')).toHaveAttribute('data-state', 'error');
  } finally { release(); }
});

test('one actual model HTTP failure is reported and a new attempt recovers without a page reload', async ({ page, context }) => {
  let rejected = false;
  const pattern = '**/vendor/vision/pose_landmarker_full.task';
  const failOnce = async (route: import('@playwright/test').Route) => {
    if (!rejected) {
      rejected = true;
      // Fault injection changes transport status only; no vision result is synthesized.
      await route.fulfill({ status: 503, contentType: 'text/plain', body: 'Deliberate model-load HTTP failure for the retry check.' });
    } else await route.continue();
  };
  await context.route(pattern, failOnce);
  const navigationOrigin = await page.evaluate(() => performance.timeOrigin);
  await page.locator('#sample-photo').click();
  await expect(page.locator('#photo-canvas')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#status-box')).toHaveAttribute('data-state', 'error');
  await expect.poll(() => page.evaluate(() => (window as any).__puppifyQA.fatalErrors.length)).toBe(1);
  expect(rejected).toBeTruthy();
  await expect(page.locator('#build-puppet')).toBeDisabled();
  await expect(page.locator('#download-png')).toBeDisabled();
  await context.unroute(pattern, failOnce);
  await buildExample(page);
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(navigationOrigin);
  expect(await page.evaluate(() => (window as any).__puppifyQA.workers)).toBeGreaterThanOrEqual(2);
  const detected = (await actualResults(page)).find(item => item.request?.withMask && item.detected);
  expect(detected.landmarks).toHaveLength(33);
});

test('no-person motion runs real negative inference and holds the previously built photographic pose', async ({ page }) => {
  await buildExample(page);
  const reference = await readPose(page);
  // Procedural blank video is deliberately a negative control, never success evidence.
  const encoded = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#888'; ctx.fillRect(0, 0, 640, 480);
    const stream = canvas.captureStream(8); const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const stopped = new Promise<Blob>(resolve => {
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
    });
    recorder.start();
    for (let i = 0; i < 5; i++) { ctx.fillRect(0, 0, 640, 480); await new Promise(resolve => setTimeout(resolve, 100)); }
    recorder.stop(); const blob = await stopped; stream.getTracks().forEach(track => track.stop());
    return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
  });
  await page.locator('#video-file').setInputFiles({ name: 'blank-motion-negative-control.webm', mimeType: 'video/webm', buffer: Buffer.from(encoded, 'base64') });
  await expect.poll(() => page.locator('#motion-video').evaluate(video => (video as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  await page.locator('#motion-video').evaluate(video => (video as HTMLVideoElement).play());
  await expect.poll(async () => (await actualResults(page)).filter(item => item.request?.withMask === false && !item.detected && !item.error).length).toBeGreaterThanOrEqual(2);
  await expect(page.locator('#stage-mode')).toHaveText('HOLDING POSE');
  await expect(page.locator('#motion-status')).toContainText('Person not found');
  expect(poseDistance(reference, await readPose(page))).toBeLessThan(0.00001);
  await page.locator('#motion-video').evaluate(video => (video as HTMLVideoElement).pause());
});

test('editor fits the viewport before and after actual photo processing', async ({ page }) => {
  const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  expect(await noOverflow()).toBeTruthy();
  await buildExample(page);
  expect(await noOverflow()).toBeTruthy();
  for (const selector of ['#photo-canvas', '#puppet-canvas', '#download-png', '#sample-video']) {
    const box = await page.locator(selector).boundingBox();
    expect(box).toBeTruthy(); expect(box!.width).toBeGreaterThan(20);
    const width = await page.evaluate(() => window.innerWidth);
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  }
});
