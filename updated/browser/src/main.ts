import './style.css';
import { createPuppet, mirrorPose, JOINT_NAMES, type Puppet, type Pose, type JointName, type Point, type PersonMask } from './puppet';
import { createVision, type VisionClient, type VisionResult } from './vision';

const $ = <T extends HTMLElement = HTMLElement>(selector: string): T => {
  const value = document.querySelector<T>(selector);
  if (!value) throw new Error(`Missing interface element: ${selector}`);
  return value;
};
const photoCanvas = $<HTMLCanvasElement>('#photo-canvas');
const puppetCanvas = $<HTMLCanvasElement>('#puppet-canvas');
const video = $<HTMLVideoElement>('#motion-video');
const buildButton = $<HTMLButtonElement>('#build-puppet');
const editButton = $<HTMLButtonElement>('#adjust-joints');
const resetButton = $<HTMLButtonElement>('#reset-pose');
const saveButton = $<HTMLButtonElement>('#download-png');
const showJoints = $<HTMLInputElement>('#show-joints');
const maskThreshold = $<HTMLInputElement>('#mask-threshold');
const mirrorMotion = $<HTMLInputElement>('#mirror-motion');
const source = document.createElement('canvas');
const frame = document.createElement('canvas');
const base = import.meta.env.BASE_URL;
let vision: VisionClient | undefined;
let puppet: Puppet | undefined;
let pose: Pose = {};
let personMask: PersonMask | undefined;
let editing = false;
let photoBusy = false;
let inferenceBusy = false;
let sourceName = '';
let imageGeneration = 0;
let videoGeneration = 0;
let photoAbort: AbortController | undefined;
let videoURL: string | undefined;
let motionRunning = false;
let motionEpoch = 0;
let cancelVideoLoad: (() => void) | undefined;
let motionTimer = 0;
let lastVideoTime = -1;
let motionFrames = 0;
let lastInferenceMs = 0;
let lastPose: Pose = {};
let activeSourceJoint: JointName | undefined;
let activePuppetJoint: JointName | undefined;
let needsDraw = true;

const INDEX: Record<JointName, number> = {
  nose: 0, leftShoulder: 11, rightShoulder: 12, leftElbow: 13, rightElbow: 14,
  leftWrist: 15, rightWrist: 16, leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28,
};
const BONES: [JointName, JointName][] = [
  ['leftShoulder', 'rightShoulder'], ['leftShoulder', 'leftHip'], ['rightShoulder', 'rightHip'],
  ['leftHip', 'rightHip'], ['leftShoulder', 'leftElbow'], ['leftElbow', 'leftWrist'],
  ['rightShoulder', 'rightElbow'], ['rightElbow', 'rightWrist'],
  ['leftHip', 'leftKnee'], ['leftKnee', 'leftAnkle'], ['rightHip', 'rightKnee'], ['rightKnee', 'rightAnkle'],
];

function normalizedPose(result: VisionResult, mirror = false): Pose {
  const detected = Object.fromEntries(JOINT_NAMES.map(name => {
    const landmark = result.landmarks[INDEX[name]];
    return [name, { x: landmark.x, y: landmark.y,
      confidence: Math.min(landmark.visibility ?? 1, landmark.presence ?? 1) }];
  }));
  return mirror ? mirrorPose(detected) : detected;
}

function status(message: string, state: 'idle' | 'busy' | 'error' = 'idle'): void {
  $('#status-text').textContent = message;
  $('#status-box').className = `status-box ${state}`;
  $('#status-icon').textContent = state === 'busy' ? '' : state === 'error' ? '!' : '·';
  $('#status-box').dataset.state = state;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The operation could not be completed.';
}

function getVision(): VisionClient {
  if (!vision || vision.isClosed) vision = createVision({ onProgress(progress) {
    if (progress.stage === 'loading' || progress.stage === 'fallback') status(progress.message, 'busy');
  } });
  return vision;
}

function setControls(): void {
  buildButton.disabled = photoBusy || !personMask;
  editButton.disabled = photoBusy || !personMask;
  resetButton.disabled = !puppet;
  saveButton.disabled = !puppet;
  buildButton.querySelector('span')!.textContent = puppet ? 'Rebuild puppet' : 'Build puppet';
}

function view() { return { width: puppetCanvas.clientWidth, height: puppetCanvas.clientHeight }; }

function resize(): void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const bounds = view();
  puppetCanvas.width = Math.round(bounds.width * dpr);
  puppetCanvas.height = Math.round(bounds.height * dpr);
  drawSource();
  needsDraw = true;
}

function paint(): void {
  if (needsDraw) {
    const ctx = puppetCanvas.getContext('2d')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view().width, view().height);
    puppet?.draw(ctx, view(), { showJoints: showJoints.checked });
    if (puppet) {
      puppetCanvas.dataset.screenJoints = JSON.stringify(puppet.getScreenJoints(view()));
      puppetCanvas.dataset.pose = JSON.stringify(puppet.getJointPositions());
      puppetCanvas.dataset.partSummary = JSON.stringify(puppet.getPartSummary());
    }
    needsDraw = false;
  }
  requestAnimationFrame(paint);
}

function photoFit(): { scale: number; x: number; y: number } {
  const scale = Math.min(photoCanvas.width / source.width, photoCanvas.height / source.height);
  return { scale, x: (photoCanvas.width - source.width * scale) / 2, y: (photoCanvas.height - source.height * scale) / 2 };
}

function drawSource(): void {
  const bounds = photoCanvas.getBoundingClientRect();
  photoCanvas.width = Math.max(1, Math.round(bounds.width * 2));
  photoCanvas.height = Math.max(1, Math.round(bounds.height * 2));
  const ctx = photoCanvas.getContext('2d')!;
  ctx.clearRect(0, 0, photoCanvas.width, photoCanvas.height);
  if (!source.width || !source.height || !sourceName) return;
  const { scale, x, y } = photoFit();
  ctx.drawImage(source, x, y, source.width * scale, source.height * scale);
  if (!personMask) return;
  const at = (p: Point) => ({ x: x + p.x * source.width * scale, y: y + p.y * source.height * scale });
  photoCanvas.dataset.pose = JSON.stringify(pose);
  photoCanvas.dataset.screenJoints = JSON.stringify(Object.fromEntries(JOINT_NAMES.filter(name => pose[name]).map(name => { const point = at(pose[name]!); return [name, {x: point.x * bounds.width / photoCanvas.width, y: point.y * bounds.height / photoCanvas.height}]; })));
  ctx.strokeStyle = editing ? '#e5aa4f' : '#d9e0ab'; ctx.lineWidth = 2;
  for (const [a, b] of BONES) {
    if (!pose[a] || !pose[b]) continue;
    const first = at(pose[a]!); const second = at(pose[b]!);
    ctx.beginPath(); ctx.moveTo(first.x, first.y); ctx.lineTo(second.x, second.y); ctx.stroke();
  }
  for (const name of JOINT_NAMES) {
    if (!pose[name]) continue;
    const p = at(pose[name]!);
    ctx.beginPath(); ctx.arc(p.x, p.y, editing ? 7 : 4, 0, Math.PI * 2);
    ctx.fillStyle = editing ? '#bf602b' : '#f1ead4'; ctx.fill();
    ctx.strokeStyle = '#3f5035'; ctx.lineWidth = 1.5; ctx.stroke();
  }
}

function clearPuppet(): void {
  puppet?.dispose(); puppet = undefined;
  puppetCanvas.dataset.state = 'empty';
  for (const key of ['parts', 'pose', 'screenJoints', 'partSummary', 'foregroundPixels', 'inferenceMs']) delete puppetCanvas.dataset[key];
  $('#stage-empty').hidden = false;
  $('#stage-caption').hidden = true;
  $('#stage-mode').textContent = 'WAITING FOR PHOTO';
  needsDraw = true;
}

function stopMotion(pause = true): void {
  ++motionEpoch;
  motionRunning = false;
  clearTimeout(motionTimer);
  if (pause) video.pause();
}

async function readPhoto(blob: Blob, name: string): Promise<void> {
  if (!blob.size || blob.size > 25 * 1024 * 1024) {
    status(blob.size ? 'Choose a photograph smaller than 25 MB.' : 'The selected image is empty.', 'error');
    return;
  }
  const generation = ++imageGeneration;
  photoAbort?.abort(); photoAbort = new AbortController();
  stopMotion();
  photoCanvas.dataset.state = 'loading';
  for (const key of ['joints', 'pose', 'screenJoints', 'corrected', 'inferenceMs', 'delegate']) delete photoCanvas.dataset[key];
  // Closing the old worker is the cancellation boundary for an in-flight model.
  if (inferenceBusy || photoBusy) { vision?.close(); vision = undefined; inferenceBusy = false; }
  photoBusy = true; editing = false; editButton.setAttribute('aria-pressed', 'false');
  personMask = undefined; pose = {}; clearPuppet(); setControls();
  status('Reading photograph…', 'busy');
  let bitmap: ImageBitmap | undefined;
  try {
    try { bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
    catch { throw new Error('This image could not be decoded. Try a JPEG, PNG or WebP file.'); }
    if (generation !== imageGeneration) return;
    const scale = Math.min(1, 1100 / Math.max(bitmap.width, bitmap.height));
    source.width = Math.max(2, Math.round(bitmap.width * scale));
    source.height = Math.max(2, Math.round(bitmap.height * scale));
    source.getContext('2d')!.drawImage(bitmap, 0, 0, source.width, source.height);
    sourceName = name;
    $('#photo-empty').hidden = true; $('#photo-label').hidden = false;
    $('#source-info').textContent = `${source.width} × ${source.height} px`;
    drawSource();
    status('Locating the person and joints…', 'busy');
    const result = await getVision().analyze(source, { withMask: true, signal: photoAbort.signal });
    if (generation !== imageGeneration) return;
    if (!result?.mask) throw new Error('No full-body person was detected. Try a clear frontal photograph with visible arms and legs.');
    pose = normalizedPose(result); personMask = result.mask;
    lastInferenceMs = result.inferenceMs;
    photoCanvas.dataset.joints = String(result.landmarks.length);
    photoCanvas.dataset.delegate = result.delegate;
    photoCanvas.dataset.inferenceMs = String(result.inferenceMs);
    photoCanvas.dataset.state = 'detected';
    drawSource();
    status('Joints detected. Build the puppet, or adjust a joint first.');
    $('#stage-mode').textContent = 'READY TO BUILD';
  } catch (error) {
    if (generation !== imageGeneration || (error instanceof DOMException && error.name === 'AbortError')) return;
    status(errorMessage(error), 'error');
    photoCanvas.dataset.state = 'error';
  } finally {
    bitmap?.close();
    if (generation === imageGeneration) { photoBusy = false; setControls(); }
  }
}

async function build(): Promise<void> {
  if (!personMask || photoBusy) return;
  const generation = imageGeneration;
  stopMotion(); photoBusy = true; setControls(); status('Separating the body parts…', 'busy');
  await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  if (generation !== imageGeneration) return;
  try {
    const threshold = Number(maskThreshold.value);
    const input = personMask.data;
    const shifted = new Float32Array(input.length);
    const divisor = input instanceof Uint8Array ? 255 : 1;
    for (let i = 0; i < input.length; i++) shifted[i] = Math.max(0, Math.min(1, input[i] / divisor + 0.5 - threshold));
    const next = createPuppet(source, pose, { ...personMask, data: shifted });
    puppet?.dispose(); puppet = next;
    editing = false; editButton.setAttribute('aria-pressed', 'false'); drawSource();
    $('#stage-empty').hidden = true; $('#stage-caption').hidden = false;
    $('#stage-mode').textContent = 'DRAG TO POSE';
    puppetCanvas.dataset.state = 'ready'; puppetCanvas.dataset.parts = '10';
    const pixels = puppet.partition.alpha.filter(value => value > 0).length;
    puppetCanvas.dataset.foregroundPixels = String(pixels);
    puppetCanvas.dataset.pose = JSON.stringify(puppet.getJointPositions());
    status('Puppet ready. Drag its joints or try a motion clip.');
    $('#motion-status').textContent = video.src ? 'Press play to animate the puppet.' : 'Choose a video, or try the example motion.';
    needsDraw = true;
  } catch (error) { status(errorMessage(error), 'error'); }
  finally { if (generation === imageGeneration) { photoBusy = false; setControls(); } }
}

async function useSamplePhoto(): Promise<void> {
  try {
    status('Opening example photograph…', 'busy');
    const response = await fetch(`${base}examples/jumping-jacks-photo.png`);
    if (!response.ok) throw new Error('The example photograph could not be loaded.');
    await readPhoto(await response.blob(), 'Example photo');
  } catch (error) { status(errorMessage(error), 'error'); }
}

async function openMotion(blob: Blob, label: string): Promise<boolean> {
  if (blob.size > 200 * 1024 * 1024) throw new Error('Choose a video smaller than 200 MB.');
  stopMotion(); cancelVideoLoad?.(); cancelVideoLoad = undefined;
  const generation = ++videoGeneration;
  lastVideoTime = -1; motionFrames = 0;
  if (videoURL) URL.revokeObjectURL(videoURL);
  const url = URL.createObjectURL(blob); videoURL = url;
  video.loop = true; video.dataset.source = label; video.dataset.frames = '0';
  $('#motion-status').textContent = 'Reading the motion clip…';
  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        video.removeEventListener('loadeddata', ready); video.removeEventListener('error', failed);
        clearTimeout(timer); if (generation === videoGeneration) cancelVideoLoad = undefined;
      };
      const ready = () => {
        if (generation !== videoGeneration || video.currentSrc !== url || video.readyState < 2) return;
        cleanup(); resolve();
      };
      const failed = () => { if (!video.error) return; cleanup(); reject(new Error('This video format could not be decoded by your browser.')); };
      const timer = window.setTimeout(() => { cleanup(); reject(new Error('The video could not be read. Try a shorter MP4 or WebM clip.')); }, 30000);
      cancelVideoLoad = () => { cleanup(); reject(new DOMException('Video selection replaced.', 'AbortError')); };
      video.addEventListener('loadeddata', ready); video.addEventListener('error', failed);
      // Install listeners before changing the source, and explicitly reset its
      // previous decoder state; rapid selections cannot complete each other.
      video.src = url; video.load();
    });
    if (generation !== videoGeneration) return false;
    $('#video-empty').hidden = true; $('#video-label').hidden = false; $('#motion-extra').hidden = false;
    $('#motion-status').textContent = puppet ? 'Press play to drive your puppet with this clip.' : 'Build a puppet, or use a clear frame from this video as the photo.';
    return true;
  } catch (error) {
    if (generation !== videoGeneration || (error instanceof DOMException && error.name === 'AbortError')) return false;
    video.removeAttribute('src'); video.load();
    $('#video-empty').hidden = false; $('#video-label').hidden = true; $('#motion-extra').hidden = true;
    throw error;
  }
}

async function useSampleVideo(): Promise<void> {
  try {
    if (!puppet) { await useSamplePhoto(); if (personMask) await build(); }
    const response = await fetch(`${base}examples/jumping-jacks-motion.mp4`);
    if (!response.ok) throw new Error('The example clip could not be loaded.');
    const loaded = await openMotion(await response.blob(), 'Example video');
    if (loaded && puppet) await video.play();
  } catch (error) { $('#motion-status').textContent = errorMessage(error); }
}

function copyVideoFrame(): void {
  const scale = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
  frame.width = Math.max(2, Math.round(video.videoWidth * scale));
  frame.height = Math.max(2, Math.round(video.videoHeight * scale));
  frame.getContext('2d')!.drawImage(video, 0, 0, frame.width, frame.height);
}

async function trackMotion(): Promise<void> {
  if (!motionRunning || video.paused || video.ended || !puppet || photoBusy) return;
  if (inferenceBusy || video.readyState < 2 || Math.abs(lastVideoTime - video.currentTime) < 0.015) {
    motionTimer = window.setTimeout(() => { void trackMotion(); }, 20); return;
  }
  const generation = videoGeneration; const epoch = motionEpoch;
  lastVideoTime = video.currentTime; inferenceBusy = true;
  try {
    copyVideoFrame();
    const result = await getVision().analyze(frame, { withMask: false, timestamp: performance.now() });
    if (generation !== videoGeneration || epoch !== motionEpoch || !motionRunning || !puppet) return;
    motionFrames++; video.dataset.frames = String(motionFrames);
    if (result) {
      lastPose = normalizedPose(result, mirrorMotion.checked);
      const tracking = puppet.setTargetPose(lastPose);
      lastInferenceMs = result.inferenceMs;
      puppetCanvas.dataset.pose = JSON.stringify(puppet.getJointPositions());
      puppetCanvas.dataset.inferenceMs = String(lastInferenceMs);
      $('#motion-status').textContent = tracking.tracking ? 'Following the input video.' : 'Some joints are hidden. Holding their last reliable direction.';
      $('#stage-mode').textContent = tracking.tracking ? 'VIDEO MOTION' : 'PARTIAL TRACKING';
    } else {
      $('#motion-status').textContent = 'Person not found in this frame. Holding the previous pose.';
      $('#stage-mode').textContent = 'HOLDING POSE';
    }
    needsDraw = true;
  } catch (error) {
    if (generation === videoGeneration && epoch === motionEpoch && motionRunning) {
      $('#motion-status').textContent = errorMessage(error);
      stopMotion();
    }
  } finally {
    inferenceBusy = false;
    if (motionRunning && generation === videoGeneration && epoch === motionEpoch) motionTimer = window.setTimeout(() => { void trackMotion(); }, 20);
  }
}

function canvasPoint(event: PointerEvent, canvas: HTMLCanvasElement): Point {
  const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function nearestJoint(joints: Pose, point: Point, radius: number): JointName | undefined {
  let selected: JointName | undefined; let nearest = radius;
  for (const name of JOINT_NAMES) {
    const joint = joints[name]; if (!joint) continue;
    const distance = Math.hypot(joint.x - point.x, joint.y - point.y);
    if (distance < nearest) { nearest = distance; selected = name; }
  }
  return selected;
}

puppetCanvas.addEventListener('pointerdown', event => {
  if (!puppet || !showJoints.checked) return;
  const selected = nearestJoint(puppet.getScreenJoints(view()), canvasPoint(event, puppetCanvas), event.pointerType === 'touch' ? 30 : 20);
  if (!selected) return;
  stopMotion(); activePuppetJoint = selected; puppetCanvas.setPointerCapture(event.pointerId); event.preventDefault();
});
puppetCanvas.addEventListener('pointermove', event => {
  if (!activePuppetJoint || !puppet) return;
  puppet.dragJoint(activePuppetJoint, puppet.screenToPose(canvasPoint(event, puppetCanvas), view()));
  puppetCanvas.dataset.pose = JSON.stringify(puppet.getJointPositions());
  $('#stage-mode').textContent = 'DRAG TO POSE'; needsDraw = true;
});
for (const kind of ['pointerup', 'pointercancel', 'lostpointercapture']) puppetCanvas.addEventListener(kind, () => { activePuppetJoint = undefined; });
photoCanvas.addEventListener('pointerdown', event => {
  if (!editing || photoBusy) return;
  const p = canvasPoint(event, photoCanvas); const bounds = photoCanvas.getBoundingClientRect();
  p.x *= photoCanvas.width / bounds.width; p.y *= photoCanvas.height / bounds.height;
  const fit = photoFit(); const joints: Pose = {};
  for (const name of JOINT_NAMES) if (pose[name]) joints[name] = { x: fit.x + pose[name]!.x * source.width * fit.scale, y: fit.y + pose[name]!.y * source.height * fit.scale };
  activeSourceJoint = nearestJoint(joints, p, event.pointerType === 'touch' ? 55 : 35);
  if (activeSourceJoint) { photoCanvas.setPointerCapture(event.pointerId); event.preventDefault(); }
});
photoCanvas.addEventListener('pointermove', event => {
  if (!activeSourceJoint || !editing) return;
  const p = canvasPoint(event, photoCanvas); const bounds = photoCanvas.getBoundingClientRect();
  p.x *= photoCanvas.width / bounds.width; p.y *= photoCanvas.height / bounds.height;
  const fit = photoFit();
  pose[activeSourceJoint] = { x: Math.max(0, Math.min(1, (p.x - fit.x) / (source.width * fit.scale))), y: Math.max(0, Math.min(1, (p.y - fit.y) / (source.height * fit.scale))), confidence: 1 };
  photoCanvas.dataset.corrected = 'true'; drawSource();
  status('Joint adjusted. Rebuild the puppet to apply this reference pose.');
});
for (const kind of ['pointerup', 'pointercancel', 'lostpointercapture']) photoCanvas.addEventListener(kind, () => { activeSourceJoint = undefined; });

$('#sample-photo').addEventListener('click', () => { void useSamplePhoto(); });
$('#sample-video').addEventListener('click', () => { void useSampleVideo(); });
buildButton.addEventListener('click', () => { void build(); });
editButton.addEventListener('click', () => {
  editing = !editing; editButton.setAttribute('aria-pressed', String(editing));
  $('#joint-help').textContent = editing ? 'Drag a dot on the photograph, then rebuild the puppet.' : 'Joints are detected automatically. You can correct them before building.';
  drawSource();
});
resetButton.addEventListener('click', () => {
  stopMotion(); puppet?.reset(); needsDraw = true;
  if (puppet) puppetCanvas.dataset.pose = JSON.stringify(puppet.getJointPositions());
  $('#stage-mode').textContent = 'DRAG TO POSE';
  $('#motion-status').textContent = video.src ? 'Pose reset. Press play to follow the video again.' : 'Choose a video, or try the example motion.';
});
showJoints.addEventListener('change', () => { needsDraw = true; });
maskThreshold.addEventListener('input', () => { $('#threshold-value').textContent = Number(maskThreshold.value).toFixed(2); });
mirrorMotion.addEventListener('change', () => {
  video.style.transform = mirrorMotion.checked ? 'scaleX(-1)' : '';
  lastVideoTime = -1;
});
saveButton.addEventListener('click', () => {
  if (!puppet) return;
  const output = document.createElement('canvas'); output.width = 1200; output.height = 1400;
  puppet.draw(output.getContext('2d')!, { width: output.width, height: output.height }, { showJoints: false });
  output.toBlob(blob => {
    if (!blob) return; const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'puppify-puppet.png'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
});
$<HTMLInputElement>('#photo-file').addEventListener('change', event => {
  const input = event.target as HTMLInputElement; const file = input.files?.[0];
  if (file) void readPhoto(file, file.name); input.value = '';
});
$<HTMLInputElement>('#video-file').addEventListener('change', event => {
  const input = event.target as HTMLInputElement; const file = input.files?.[0];
  if (file) void openMotion(file, 'Uploaded video').catch(error => { $('#motion-status').textContent = errorMessage(error); }); input.value = '';
});
$('#use-video-frame').addEventListener('click', () => {
  if (video.readyState < 2) return;
  stopMotion(); copyVideoFrame();
  frame.toBlob(blob => { if (blob) void readPhoto(blob, 'Video reference frame'); }, 'image/png');
});
video.addEventListener('play', () => {
  if (!puppet || photoBusy) { video.pause(); $('#motion-status').textContent = 'Build a puppet before playing motion.'; return; }
  motionRunning = true; clearTimeout(motionTimer); void trackMotion();
});
video.addEventListener('pause', () => { stopMotion(false); });
video.addEventListener('seeked', () => { lastVideoTime = -1; if (!video.paused && !motionRunning) { motionRunning = true; void trackMotion(); } });

const drop = $('#photo-drop');
for (const name of ['dragenter', 'dragover']) drop.addEventListener(name, event => { event.preventDefault(); drop.classList.add('drag-over'); });
for (const name of ['dragleave', 'drop']) drop.addEventListener(name, event => { event.preventDefault(); drop.classList.remove('drag-over'); });
drop.addEventListener('drop', event => {
  const file = (event as DragEvent).dataTransfer?.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) { status('Choose an image file for the photograph.', 'error'); return; }
  void readPhoto(file, file.name);
});
document.addEventListener('visibilitychange', () => { if (document.hidden) stopMotion(); });
window.addEventListener('pagehide', event => {
  photoAbort?.abort(); cancelVideoLoad?.(); stopMotion(); vision?.close(); vision = undefined;
  if (!event.persisted) { puppet?.dispose(); if (videoURL) URL.revokeObjectURL(videoURL); }
});
$('#example-credit').innerHTML = 'Example photo & motion: <a href="https://commons.wikimedia.org/wiki/File:Jumping_jacks_and_burpees.webm">Taco Fleur / Cavemantraining</a> · <a href="https://creativecommons.org/licenses/by-sa/4.0/">CC BY-SA 4.0</a> · frame extracted; clip trimmed.';
new ResizeObserver(resize).observe($('#stage-wrap'));
new ResizeObserver(drawSource).observe($('#photo-drop'));
resize(); paint();
