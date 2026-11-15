/**
 * Photo cutouts and a planar puppet rig.
 * New implementation, Copyright (c) 2026 Aaron Wetzler.
 *
 * The recovered Puppify report describes pose-guided crops, but no original
 * source was recovered. This geometric partition is a new heuristic, not the
 * historical segmentation algorithm and not a learned body-part classifier.
 */

export const JOINT_NAMES = [
  'nose', 'leftShoulder', 'rightShoulder', 'leftElbow', 'rightElbow',
  'leftWrist', 'rightWrist', 'leftHip', 'rightHip', 'leftKnee',
  'rightKnee', 'leftAnkle', 'rightAnkle',
] as const;
export type JointName = typeof JOINT_NAMES[number];
export interface Point { x: number; y: number }
export interface Landmark extends Point { confidence?: number }
/** Coordinates are normalized to the source image, not the fitted stage. */
export type Pose = Partial<Record<JointName, Landmark>>;
/**
 * Mirror motion for a fixed photographic rig: reflect horizontal coordinates
 * and exchange the paired anatomical labels, so the left/right attachments do
 * not receive directions pointing across the torso. Confidence follows its
 * source landmark; a missing source landmark leaves its destination absent.
 */
export function mirrorPose(pose: Pose): Pose {
  const mirrored: Pose = {};
  for (const name of JOINT_NAMES) {
    const sourceName = name.startsWith('left')
      ? `right${name.slice(4)}` as JointName
      : name.startsWith('right') ? `left${name.slice(5)}` as JointName : name;
    const source = pose[sourceName];
    if (source) mirrored[name] = { ...source, x: 1 - source.x };
  }
  return mirrored;
}
export type JointPositions = Record<JointName, Point>;
export interface PersonMask {
  data: Float32Array | Uint8Array;
  width: number;
  height: number;
}
export interface View { width: number; height: number }
export interface Bounds { x: number; y: number; width: number; height: number }
export type ImageSource = HTMLCanvasElement | OffscreenCanvas | ImageBitmap;
export type PartName = 'head' | 'torso' | 'leftUpperArm' | 'leftForearm'
  | 'rightUpperArm' | 'rightForearm' | 'leftThigh' | 'leftShin'
  | 'rightThigh' | 'rightShin';

interface Bone {
  name: PartName;
  from: JointName;
  to: JointName;
}
/** Fixed anatomical order: a mirrored photograph cannot change draw order. */
export const LIMB_BONES: readonly Bone[] = [
  { name: 'leftThigh', from: 'leftHip', to: 'leftKnee' },
  { name: 'leftShin', from: 'leftKnee', to: 'leftAnkle' },
  { name: 'rightThigh', from: 'rightHip', to: 'rightKnee' },
  { name: 'rightShin', from: 'rightKnee', to: 'rightAnkle' },
  { name: 'leftUpperArm', from: 'leftShoulder', to: 'leftElbow' },
  { name: 'leftForearm', from: 'leftElbow', to: 'leftWrist' },
  { name: 'rightUpperArm', from: 'rightShoulder', to: 'rightElbow' },
  { name: 'rightForearm', from: 'rightElbow', to: 'rightWrist' },
];

/** Back legs, torso, arms and head; no inferred depth ordering is claimed. */
export const PART_ORDER: readonly PartName[] = [
  'leftThigh', 'leftShin', 'rightThigh', 'rightShin', 'torso',
  'leftUpperArm', 'leftForearm', 'rightUpperArm', 'rightForearm', 'head',
];

export interface Rig {
  width: number;
  height: number;
  reference: JointPositions;
  root: Point;
  shoulderCenter: Point;
  torsoLength: number;
  lengths: Record<PartName, number>;
}

const EPSILON = 1e-7;
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k });
const length = (a: Point): number => Math.hypot(a.x, a.y);
const distance = (a: Point, b: Point): number => length(sub(a, b));
const midpoint = (a: Point, b: Point): Point => mul(add(a, b), 0.5);
const clamp = (v: number, low: number, high: number): number => Math.max(low, Math.min(high, v));
const finite = (p: Point | undefined): p is Point => !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
const unit = (v: Point, fallback: Point = { x: 0, y: 1 }): Point => {
  const d = length(v);
  return d > EPSILON ? mul(v, 1 / d) : { ...fallback };
};
const rotate = (p: Point, a: number): Point => ({
  x: p.x * Math.cos(a) - p.y * Math.sin(a),
  y: p.x * Math.sin(a) + p.y * Math.cos(a),
});
const angle = (p: Point): number => Math.atan2(p.y, p.x);
const cloneJoints = (p: JointPositions): JointPositions => Object.fromEntries(
  JOINT_NAMES.map((name) => [name, { ...p[name] }]),
) as JointPositions;

export function reliable(p: Landmark | undefined, threshold = 0.45): p is Landmark {
  return finite(p) && Number.isFinite(p.confidence ?? 1) && (p.confidence ?? 1) >= threshold;
}

/** Build a complete rig; invalid anchors cannot silently generate giant crops. */
export function buildRig(pose: Pose, width: number, height: number): Rig {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2) {
    throw new Error('The reference image must have a positive width and height.');
  }
  const reference = {} as JointPositions;
  for (const name of JOINT_NAMES) {
    if (name === 'nose') continue;
    const p = pose[name];
    if (!reliable(p, 0.2) || p.x < -0.2 || p.x > 1.2 || p.y < -0.2 || p.y > 1.2) {
      throw new Error(`Reference pose needs a visible ${name}; choose a clear full-body frame or correct its joints.`);
    }
    reference[name] = { x: p.x * width, y: p.y * height };
  }
  const shoulderCenter = midpoint(reference.leftShoulder, reference.rightShoulder);
  const root = midpoint(reference.leftHip, reference.rightHip);
  const torsoLength = distance(root, shoulderCenter);
  if (torsoLength < Math.min(width, height) * 0.035) {
    throw new Error('The reference shoulders and hips are too close to form a puppet.');
  }
  if (distance(reference.leftShoulder, reference.rightShoulder) < Math.min(width, height) * 0.02
      || distance(reference.leftHip, reference.rightHip) < Math.min(width, height) * 0.01) {
    throw new Error('Choose a frontal reference with distinct left/right shoulders and hips.');
  }
  reference.nose = reliable(pose.nose, 0.2)
    ? { x: pose.nose.x * width, y: pose.nose.y * height }
    : add(shoulderCenter, mul(unit(sub(shoulderCenter, root)), torsoLength * 0.52));
  const lengths = { torso: torsoLength, head: distance(shoulderCenter, reference.nose) } as Record<PartName, number>;
  for (const bone of LIMB_BONES) {
    lengths[bone.name] = distance(reference[bone.from], reference[bone.to]);
    if (lengths[bone.name] < Math.min(width, height) * 0.008) {
      throw new Error(`Reference ${bone.name} is too short; correct the joint positions.`);
    }
  }
  return { width, height, reference, root, shoulderCenter, torsoLength, lengths };
}

/**
 * Analytic two-link inverse kinematics. The endpoint is clamped to reachable
 * distances; bendHint preserves the chosen elbow/knee side during a drag.
 */
export function solveTwoBoneIK(
  root: Point, target: Point, upperLength: number, lowerLength: number,
  bendHint: Point = { x: root.x + 1, y: root.y },
): { joint: Point; end: Point } {
  if (![root.x, root.y, target.x, target.y, upperLength, lowerLength].every(Number.isFinite)
      || upperLength <= EPSILON || lowerLength <= EPSILON) {
    throw new Error('Inverse kinematics requires finite points and positive bone lengths.');
  }
  const delta = sub(target, root);
  const direction = unit(delta, unit(sub(bendHint, root), { x: 0, y: 1 }));
  const reach = clamp(length(delta), Math.abs(upperLength - lowerLength) + EPSILON, upperLength + lowerLength);
  const along = (upperLength ** 2 - lowerLength ** 2 + reach ** 2) / (2 * reach);
  const away = Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2));
  const cross = direction.x * (bendHint.y - root.y) - direction.y * (bendHint.x - root.x);
  const side = cross < 0 ? -1 : 1;
  const perpendicular = { x: -direction.y * side, y: direction.x * side };
  return {
    joint: add(root, add(mul(direction, along), mul(perpendicular, away))),
    end: add(root, mul(direction, reach)),
  };
}

/**
 * Map video directions onto the photograph's fixed bone lengths. Low confidence
 * endpoints retain their previous world-space bone direction, reattached at
 * their moving parent; this does not freeze a torso-relative joint angle.
 * A rigid torso keeps the original photo's shoulder and hip attachments aligned.
 */
export function mapPoseToRig(rig: Rig, previous: JointPositions, target: Pose, threshold = 0.45): JointPositions {
  const reference = rig.reference;
  const out = cloneJoints(previous);
  const toPixels = (p: Point): Point => ({ x: p.x * rig.width, y: p.y * rig.height });
  const validCore = ['leftHip', 'rightHip', 'leftShoulder', 'rightShoulder']
    .every((key) => reliable(target[key as JointName], threshold));
  const previousRoot = midpoint(previous.leftHip, previous.rightHip);
  const previousShoulder = midpoint(previous.leftShoulder, previous.rightShoulder);
  let root = previousRoot;
  let torsoVector = sub(previousShoulder, previousRoot);
  if (validCore) {
    root = midpoint(toPixels(target.leftHip!), toPixels(target.rightHip!));
    const nextShoulder = midpoint(toPixels(target.leftShoulder!), toPixels(target.rightShoulder!));
    const nextVector = sub(nextShoulder, root);
    if (length(nextVector) > EPSILON) torsoVector = nextVector;
  }
  const rotation = angle(torsoVector) - angle(sub(rig.shoulderCenter, rig.root));
  for (const name of ['leftHip', 'rightHip', 'leftShoulder', 'rightShoulder'] as const) {
    out[name] = add(root, rotate(sub(reference[name], rig.root), rotation));
  }
  for (const bone of LIMB_BONES) {
    const from = target[bone.from];
    const to = target[bone.to];
    const targetVector = reliable(from, threshold) && reliable(to, threshold)
      ? sub(toPixels(to), toPixels(from)) : { x: 0, y: 0 };
    const priorDirection = unit(sub(previous[bone.to], previous[bone.from]), unit(sub(reference[bone.to], reference[bone.from])));
    out[bone.to] = add(out[bone.from], mul(unit(targetVector, priorDirection), rig.lengths[bone.name]));
  }
  const nextShoulderCenter = midpoint(out.leftShoulder, out.rightShoulder);
  const nose = target.nose;
  const shoulderTargetsValid = reliable(target.leftShoulder, threshold) && reliable(target.rightShoulder, threshold);
  const headVector = reliable(nose, threshold) && shoulderTargetsValid
    ? sub(toPixels(nose), midpoint(toPixels(target.leftShoulder!), toPixels(target.rightShoulder!)))
    : sub(previous.nose, previousShoulder);
  out.nose = add(nextShoulderCenter, mul(unit(headVector, unit(sub(reference.nose, rig.shoulderCenter))), rig.lengths.head));
  return out;
}

export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const segment = sub(b, a);
  const squared = segment.x ** 2 + segment.y ** 2;
  if (squared <= EPSILON) return distance(p, a);
  const ap = sub(p, a);
  const t = clamp((ap.x * segment.x + ap.y * segment.y) / squared, 0, 1);
  return distance(p, add(a, mul(segment, t)));
}

function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]; const b = polygon[j];
    if ((a.y > p.y) !== (b.y > p.y)
      && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

interface PartGeometry { name: PartName; from: Point; to: Point; radius: number }

function partGeometries(rig: Rig): PartGeometry[] {
  const p = rig.reference;
  const shoulderWidth = distance(p.leftShoulder, p.rightShoulder);
  const hipWidth = distance(p.leftHip, p.rightHip);
  const headRadius = Math.max(shoulderWidth * 0.28, rig.torsoLength * 0.19);
  const geometry: PartGeometry[] = [
    { name: 'torso', from: rig.root, to: rig.shoulderCenter, radius: Math.max(shoulderWidth, hipWidth) * 0.5 },
    // Nose is not the head center; the head axis extends beyond it by a small,
    // explicit geometric amount. All retained pixels still come from the photo.
    { name: 'head', from: add(rig.shoulderCenter, mul(sub(p.nose, rig.shoulderCenter), 0.45)),
      to: add(p.nose, mul(unit(sub(p.nose, rig.shoulderCenter)), headRadius * 0.5)), radius: headRadius },
  ];
  for (const bone of LIMB_BONES) {
    const leg = bone.name.includes('Thigh') || bone.name.includes('Shin');
    const upper = bone.name.includes('Thigh') || bone.name.includes('UpperArm');
    const bodyWidth = leg ? hipWidth : shoulderWidth;
    const radius = Math.max(rig.lengths[bone.name] * (upper ? 0.23 : 0.19), bodyWidth * (leg ? 0.25 : 0.14));
    // Wrist landmarks stop before the fingers. A distal extension assigns the
    // observed hand to its forearm even when a raised hand is above the head.
    const hand = bone.name.includes('Forearm');
    const to = hand ? add(p[bone.to], mul(sub(p[bone.to], p[bone.from]), 0.65)) : p[bone.to];
    geometry.push({ name: bone.name, from: p[bone.from], to, radius });
  }
  return geometry;
}

/**
 * Assign one foreground pixel geometrically. A person mask says foreground,
 * not limb identity; crossed or occluded limbs are intrinsically ambiguous.
 */
export function classifyPart(rig: Rig, point: Point): PartName {
  return classifyWithGeometry(rig, partGeometries(rig), point);
}

function classifyWithGeometry(rig: Rig, geometry: PartGeometry[], point: Point): PartName {
  const p = rig.reference;
  const torsoPolygon = [p.leftShoulder, p.rightShoulder, p.rightHip, p.leftHip];
  if (pointInPolygon(point, torsoPolygon)) return 'torso';
  let best: PartName = 'torso';
  let score = Number.POSITIVE_INFINITY;
  for (const g of geometry) {
    let candidate = pointSegmentDistance(point, g.from, g.to) / Math.max(1, g.radius);
    if (g.name === 'torso') {
      const axis = sub(rig.shoulderCenter, rig.root);
      const relative = sub(point, rig.root);
      const projection = (relative.x * axis.x + relative.y * axis.y) / rig.torsoLength ** 2;
      // A broad torso radius must not capture fingers above raised shoulders.
      candidate += Math.max(0, projection - 1.2) * 4;
    }
    if (candidate < score) { score = candidate; best = g.name; }
  }
  return best;
}

/** Bilinear mask sample; Uint8 masks use [0,255], Float32 masks use [0,1]. */
export function maskProbability(mask: PersonMask, x: number, y: number, width: number, height: number): number {
  if (!Number.isInteger(mask.width) || !Number.isInteger(mask.height)
      || mask.width < 1 || mask.height < 1 || mask.data.length !== mask.width * mask.height) {
    throw new Error('The person mask dimensions do not match its pixel data.');
  }
  const mx = clamp(x / width * mask.width - 0.5, 0, mask.width - 1);
  const my = clamp(y / height * mask.height - 0.5, 0, mask.height - 1);
  const x0 = Math.floor(mx); const y0 = Math.floor(my);
  const x1 = Math.min(x0 + 1, mask.width - 1); const y1 = Math.min(y0 + 1, mask.height - 1);
  const fx = mx - x0; const fy = my - y0;
  const divisor = mask.data instanceof Uint8Array ? 255 : 1;
  const sample = (sx: number, sy: number): number => {
    const raw = mask.data[sy * mask.width + sx];
    return Number.isFinite(raw) ? clamp(raw / divisor, 0, 1) : 0;
  };
  return (1 - fy) * ((1 - fx) * sample(x0, y0) + fx * sample(x1, y0))
    + fy * ((1 - fx) * sample(x0, y1) + fx * sample(x1, y1));
}

export interface Partition {
  /** 255 means background; other values index PART_ORDER. */
  labels: Uint8Array;
  alpha: Uint8Array;
  width: number;
  height: number;
  removedNoisePixels?: number;
}

/**
 * Remove only tiny detached components away from every plausible body part.
 * This is not a largest-component filter: disconnected hands/feet near the rig
 * and larger disconnected regions are retained. It never adds foreground.
 */
export function pruneTinyComponents(partition: Partition, rig: Rig): number {
  const { alpha, labels, width, height } = partition;
  const total = alpha.reduce((count, value) => count + (value > 0 ? 1 : 0), 0);
  const limit = Math.max(3, Math.floor(total * 0.002));
  const visited = new Uint8Array(alpha.length);
  const queue = new Uint32Array(alpha.length);
  const geometry = partGeometries(rig);
  let removed = 0;
  for (let seed = 0; seed < alpha.length; seed++) {
    if (visited[seed] || !alpha[seed]) continue;
    let start = 0; let end = 1;
    queue[0] = seed; visited[seed] = 1;
    let nearRig = false;
    while (start < end) {
      const index = queue[start++];
      const x = index % width; const y = Math.floor(index / width);
      if (!nearRig && end < limit) {
        nearRig = geometry.some((g) => pointSegmentDistance({ x, y }, g.from, g.to) <= g.radius * 1.5);
      }
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
          const neighbor = (y + dy) * width + x + dx;
          if (visited[neighbor] || !alpha[neighbor]) continue;
          visited[neighbor] = 1; queue[end++] = neighbor;
        }
      }
    }
    if (end < limit && !nearRig) {
      for (let i = 0; i < end; i++) { alpha[queue[i]] = 0; labels[queue[i]] = 255; }
      removed += end;
    }
  }
  return removed;
}

/** Pure geometry/data helper, also used by focused tests without a DOM. */
export function partitionMask(rig: Rig, mask: PersonMask): Partition {
  // Validate even if an entirely transparent image would otherwise skip pixels.
  maskProbability(mask, 0, 0, rig.width, rig.height);
  const width = Math.round(rig.width); const height = Math.round(rig.height);
  const labels = new Uint8Array(width * height).fill(255);
  const alpha = new Uint8Array(width * height);
  const geometry = partGeometries(rig);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const probability = maskProbability(mask, x + 0.5, y + 0.5, width, height);
      // A narrow confidence ramp softens the model boundary without painting
      // pixels outside the supplied mask or inventing occluded surface texture.
      alpha[index] = Math.round(clamp((probability - 0.3) / 0.4, 0, 1) * 255);
      if (!alpha[index]) continue;
      labels[index] = PART_ORDER.indexOf(classifyWithGeometry(rig, geometry, { x: x + 0.5, y: y + 0.5 }));
    }
  }
  const partition = { labels, alpha, width, height, removedNoisePixels: 0 };
  partition.removedNoisePixels = pruneTinyComponents(partition, rig);
  return partition;
}

interface Cutout {
  name: PartName;
  canvas: HTMLCanvasElement;
  x: number;
  y: number;
  from: Point;
  to: Point;
  pixels: number;
}

function partEndpoints(name: PartName, joints: JointPositions): [Point, Point] {
  if (name === 'torso') return [midpoint(joints.leftHip, joints.rightHip), midpoint(joints.leftShoulder, joints.rightShoulder)];
  if (name === 'head') return [midpoint(joints.leftShoulder, joints.rightShoulder), joints.nose];
  const bone = LIMB_BONES.find((item) => item.name === name)!;
  return [joints[bone.from], joints[bone.to]];
}

function sharedHinges(rig: Rig, owner: PartName, candidate: PartName): { point: Point; radius: number }[] {
  // Duplicate observed pixels only at a shared hinge. This gives connected
  // joints a small overlap; it cannot fill texture hidden in the photograph.
  const [a, b] = partEndpoints(owner, rig.reference);
  const [c, d] = partEndpoints(candidate, rig.reference);
  const radius = Math.max(2, Math.min(rig.lengths[owner], rig.lengths[candidate]) * 0.16);
  const hinges: { point: Point; radius: number }[] = [];
  for (const first of [a, b]) {
    for (const second of [c, d]) {
      if (distance(first, second) <= 0.5) hinges.push({ point: first, radius });
    }
  }
  // Torso uses its central axis for rendering but limbs attach at its corners.
  const limbName = candidate === 'torso' ? owner : owner === 'torso' ? candidate : undefined;
  if (limbName) {
    const limb = LIMB_BONES.find((bone) => bone.name === limbName);
    if (limb && ['leftShoulder', 'rightShoulder', 'leftHip', 'rightHip'].includes(limb.from)) {
      hinges.push({ point: rig.reference[limb.from], radius: Math.max(radius, rig.lengths[limbName] * 0.21) });
    }
  }
  return hinges;
}

function createCutouts(source: ImageSource, rig: Rig, partition: Partition): Cutout[] {
  const image = document.createElement('canvas');
  image.width = rig.width; image.height = rig.height;
  const imageContext = image.getContext('2d', { willReadFrequently: true });
  if (!imageContext) throw new Error('Canvas 2D is unavailable.');
  imageContext.drawImage(source, 0, 0, rig.width, rig.height);
  const rgba = imageContext.getImageData(0, 0, rig.width, rig.height).data;
  const selections: number[][] = PART_ORDER.map(() => []);
  const bounds = PART_ORDER.map(() => ({ minX: rig.width, minY: rig.height, maxX: -1, maxY: -1 }));
  const overlaps = PART_ORDER.map((owner) => PART_ORDER.flatMap((candidate, id) => {
    if (candidate === owner) return [];
    const hinges = sharedHinges(rig, owner, candidate);
    return hinges.length ? [{ id, hinges }] : [];
  }));
  const select = (id: number, index: number, x: number, y: number): void => {
    selections[id].push(index);
    const box = bounds[id];
    box.minX = Math.min(box.minX, x); box.maxX = Math.max(box.maxX, x);
    box.minY = Math.min(box.minY, y); box.maxY = Math.max(box.maxY, y);
  };
  for (let y = 0; y < rig.height; y++) {
    for (let x = 0; x < rig.width; x++) {
      const index = y * rig.width + x;
      const ownerId = partition.labels[index];
      if (!partition.alpha[index] || ownerId === 255) continue;
      select(ownerId, index, x, y);
      for (const overlap of overlaps[ownerId]) {
        if (overlap.hinges.some(({ point, radius }) => (point.x - x) ** 2 + (point.y - y) ** 2 <= radius ** 2)) {
          select(overlap.id, index, x, y);
        }
      }
    }
  }
  const cutouts: Cutout[] = [];
  for (const name of PART_ORDER) {
    const id = PART_ORDER.indexOf(name);
    const selected = selections[id];
    let { minX, minY } = bounds[id];
    const { maxX, maxY } = bounds[id];
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, maxX - minX + 1);
    canvas.height = Math.max(1, maxY - minY + 1);
    if (!selected.length) { minX = 0; minY = 0; }
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is unavailable.');
    const pixels = ctx.createImageData(canvas.width, canvas.height);
    for (const index of selected) {
      const x = index % rig.width; const y = Math.floor(index / rig.width);
      const destination = ((y - minY) * canvas.width + x - minX) * 4;
      const original = index * 4;
      pixels.data[destination] = rgba[original];
      pixels.data[destination + 1] = rgba[original + 1];
      pixels.data[destination + 2] = rgba[original + 2];
      pixels.data[destination + 3] = Math.round(rgba[original + 3] * partition.alpha[index] / 255);
    }
    ctx.putImageData(pixels, 0, 0);
    const [from, to] = partEndpoints(name, rig.reference);
    cutouts.push({ name, canvas, x: minX, y: minY, from, to, pixels: selected.length });
  }
  image.width = image.height = 1;
  return cutouts;
}

export interface TrackingState { tracking: boolean; reliableJoints: number; totalJoints: number }

/** Constant reference bounds keep stage scale stable across video frames. */
export function foregroundBounds(partition: Partition): Bounds {
  let minX = partition.width; let maxX = -1; let minY = partition.height; let maxY = -1;
  for (let y = 0; y < partition.height; y++) {
    for (let x = 0; x < partition.width; x++) {
      if (partition.alpha[y * partition.width + x] < 128) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error('No confident foreground person was found.');
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export function fitStage(bounds: Bounds, view: View): { scale: number; offset: Point } {
  // A constant 25% envelope leaves space for bending while showing the person
  // at approximately 80% of stage height when height is the limiting factor.
  const scale = Math.min(view.width / (bounds.width * 1.25), view.height / (bounds.height * 1.25));
  return { scale, offset: {
    x: view.width / 2 - (bounds.x + bounds.width / 2) * scale,
    y: view.height / 2 - (bounds.y + bounds.height / 2) * scale,
  } };
}

export class Puppet {
  readonly rig: Rig;
  readonly partition: Partition;
  readonly bounds: Bounds;
  private joints: JointPositions;
  private cutouts: Cutout[];
  private disposed = false;

  constructor(source: ImageSource, pose: Pose, mask: PersonMask) {
    this.rig = buildRig(pose, source.width, source.height);
    this.joints = cloneJoints(this.rig.reference);
    this.partition = partitionMask(this.rig, mask);
    this.bounds = foregroundBounds(this.partition);
    this.cutouts = createCutouts(source, this.rig, this.partition);
  }

  setTargetPose(pose: Pose): TrackingState {
    const reliableJoints = JOINT_NAMES.filter((name) => reliable(pose[name])).length;
    this.joints = mapPoseToRig(this.rig, this.joints, pose);
    return { tracking: reliableJoints >= 8, reliableJoints, totalJoints: JOINT_NAMES.length };
  }

  reset(): void { this.joints = cloneJoints(this.rig.reference); }

  getJointPositions(): Pose {
    return Object.fromEntries(JOINT_NAMES.map((name) => [name, {
      x: this.joints[name].x / this.rig.width,
      y: this.joints[name].y / this.rig.height,
      confidence: 1,
    }]));
  }

  private stage(view: View): { scale: number; offset: Point } {
    return fitStage(this.bounds, view);
  }

  getPartSummary(): { name: PartName; pixels: number; width: number; height: number }[] {
    return this.cutouts.map(({ name, pixels, canvas }) => ({ name, pixels, width: canvas.width, height: canvas.height }));
  }

  screenToPose(point: Point, view: View): Point {
    const { scale, offset } = this.stage(view);
    return { x: (point.x - offset.x) / scale / this.rig.width, y: (point.y - offset.y) / scale / this.rig.height };
  }

  getScreenJoints(view: View): Pose {
    const { scale, offset } = this.stage(view);
    return Object.fromEntries(JOINT_NAMES.map((name) => [name, add(mul(this.joints[name], scale), offset)]));
  }

  /** Drag endpoint with two-link IK; intermediate joints rotate their subtree. */
  dragJoint(name: JointName, normalized: Point): void {
    if (!finite(normalized)) return;
    const target = { x: normalized.x * this.rig.width, y: normalized.y * this.rig.height };
    const chains: [JointName, JointName, JointName, PartName, PartName][] = [
      ['leftShoulder', 'leftElbow', 'leftWrist', 'leftUpperArm', 'leftForearm'],
      ['rightShoulder', 'rightElbow', 'rightWrist', 'rightUpperArm', 'rightForearm'],
      ['leftHip', 'leftKnee', 'leftAnkle', 'leftThigh', 'leftShin'],
      ['rightHip', 'rightKnee', 'rightAnkle', 'rightThigh', 'rightShin'],
    ];
    for (const [anchor, joint, end, upper, lower] of chains) {
      if (name === end) {
        const result = solveTwoBoneIK(this.joints[anchor], target, this.rig.lengths[upper], this.rig.lengths[lower], this.joints[joint]);
        this.joints[joint] = result.joint; this.joints[end] = result.end;
        return;
      }
      if (name === joint) {
        const lowerDirection = unit(sub(this.joints[end], this.joints[joint]));
        this.joints[joint] = add(this.joints[anchor], mul(unit(sub(target, this.joints[anchor])), this.rig.lengths[upper]));
        this.joints[end] = add(this.joints[joint], mul(lowerDirection, this.rig.lengths[lower]));
        return;
      }
    }
    if (name === 'nose') {
      const shoulders = midpoint(this.joints.leftShoulder, this.joints.rightShoulder);
      this.joints.nose = add(shoulders, mul(unit(sub(target, shoulders)), this.rig.lengths.head));
      return;
    }
    // Dragging a torso anchor translates the entire connected photograph.
    const delta = sub(target, this.joints[name]);
    for (const key of JOINT_NAMES) this.joints[key] = add(this.joints[key], delta);
  }

  draw(context: CanvasRenderingContext2D, view: View, options: { showJoints?: boolean; background?: string } = {}): void {
    if (this.disposed) return;
    context.save();
    if (options.background) { context.fillStyle = options.background; context.fillRect(0, 0, view.width, view.height); }
    else context.clearRect(0, 0, view.width, view.height);
    const { scale, offset } = this.stage(view);
    context.translate(offset.x, offset.y);
    context.scale(scale, scale);
    for (const cutout of this.cutouts) {
      const [from, to] = partEndpoints(cutout.name, this.joints);
      const rotation = angle(sub(to, from)) - angle(sub(cutout.to, cutout.from));
      context.save();
      context.translate(from.x, from.y);
      context.rotate(rotation);
      context.translate(-cutout.from.x, -cutout.from.y);
      context.drawImage(cutout.canvas, cutout.x, cutout.y);
      context.restore();
    }
    if (options.showJoints) {
      context.lineWidth = 1.5 / scale;
      context.strokeStyle = 'rgba(255,255,255,.75)';
      for (const bone of LIMB_BONES) {
        context.beginPath(); context.moveTo(this.joints[bone.from].x, this.joints[bone.from].y);
        context.lineTo(this.joints[bone.to].x, this.joints[bone.to].y); context.stroke();
      }
      for (const name of JOINT_NAMES) {
        context.beginPath(); context.arc(this.joints[name].x, this.joints[name].y, 5 / scale, 0, Math.PI * 2);
        context.fillStyle = '#00d5c0'; context.fill();
        context.strokeStyle = '#08382f'; context.stroke();
      }
    }
    context.restore();
  }

  /** Only our cutout canvases are owned; the caller retains its source image. */
  dispose(): void {
    for (const part of this.cutouts) part.canvas.width = part.canvas.height = 1;
    this.cutouts = [];
    this.disposed = true;
  }
}

export function createPuppet(source: ImageSource, pose: Pose, mask: PersonMask): Puppet {
  return new Puppet(source, pose, mask);
}
