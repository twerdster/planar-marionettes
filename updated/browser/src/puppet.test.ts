/** New implementation tests, Copyright (c) 2026 Aaron Wetzler. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRig, classifyPart, fitStage, foregroundBounds, JOINT_NAMES, LIMB_BONES, mapPoseToRig, mirrorPose,
  maskProbability, PART_ORDER, partitionMask, reliable, solveTwoBoneIK,
  type JointPositions, type Point, type Pose,
} from './puppet';

const photoPose = (): Pose => ({
  nose: { x: 0.5, y: 0.12 },
  leftShoulder: { x: 0.38, y: 0.25 }, rightShoulder: { x: 0.62, y: 0.25 },
  leftElbow: { x: 0.28, y: 0.4 }, rightElbow: { x: 0.72, y: 0.4 },
  leftWrist: { x: 0.18, y: 0.52 }, rightWrist: { x: 0.82, y: 0.52 },
  leftHip: { x: 0.43, y: 0.52 }, rightHip: { x: 0.57, y: 0.52 },
  leftKnee: { x: 0.41, y: 0.73 }, rightKnee: { x: 0.59, y: 0.73 },
  leftAnkle: { x: 0.39, y: 0.94 }, rightAnkle: { x: 0.61, y: 0.94 },
});
const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const close = (actual: number, expected: number, tolerance = 1e-7): void => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`);
};
const vector = (a: Point, b: Point): Point => ({ x: b.x - a.x, y: b.y - a.y });
const assertLengths = (rig: ReturnType<typeof buildRig>, joints: JointPositions): void => {
  for (const bone of LIMB_BONES) close(distance(joints[bone.from], joints[bone.to]), rig.lengths[bone.name]);
  close(distance(joints.leftShoulder, joints.rightShoulder), distance(rig.reference.leftShoulder, rig.reference.rightShoulder));
  close(distance(joints.leftHip, joints.rightHip), distance(rig.reference.leftHip, rig.reference.rightHip));
};

test('two-link IK reaches a bent target and maintains both reference lengths', () => {
  const root = { x: 0, y: 0 }; const target = { x: 6, y: 3 };
  const result = solveTwoBoneIK(root, target, 5, 4, { x: 0, y: 5 });
  close(distance(root, result.joint), 5);
  close(distance(result.joint, result.end), 4);
  close(distance(result.end, target), 0);
  assert.ok(result.joint.y > 3, 'the elbow follows the supplied positive bend hint');
  const other = solveTwoBoneIK(root, target, 5, 4, { x: 5, y: -3 });
  assert.ok(other.joint.y < 0, 'opposite bend hint selects the other valid elbow');
});

test('IK clamps unreachable targets, and coincident endpoints remain finite', () => {
  const root = { x: 2, y: 3 };
  const extended = solveTwoBoneIK(root, { x: 100, y: 3 }, 5, 4);
  close(distance(root, extended.end), 9);
  close(distance(root, extended.joint), 5);
  close(distance(extended.joint, extended.end), 4);
  const collapsed = solveTwoBoneIK(root, root, 5, 5);
  assert.ok(Object.values(collapsed).every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
  close(distance(root, collapsed.joint), 5);
  close(distance(collapsed.joint, collapsed.end), 5);
  const unequal = solveTwoBoneIK(root, root, 7, 3);
  close(distance(root, unequal.joint), 7);
  close(distance(unequal.joint, unequal.end), 3);
  assert.throws(() => solveTwoBoneIK(root, root, 0, 3), /positive bone lengths/);
  assert.throws(() => solveTwoBoneIK(root, { x: NaN, y: 1 }, 3, 3), /finite points/);
});

test('mapping a moving, bent video pose preserves photograph bone lengths', () => {
  const rig = buildRig(photoPose(), 200, 400);
  const target = photoPose();
  target.leftElbow = { x: 0.2, y: 0.25 };
  target.leftWrist = { x: 0.2, y: 0.04 };
  target.rightKnee = { x: 0.75, y: 0.63 };
  target.rightAnkle = { x: 0.62, y: 0.74 };
  // A video with a smaller projected person does not shrink the photo texture.
  for (const name of JOINT_NAMES) {
    target[name] = { x: target[name]!.x * 0.7 + 0.15, y: target[name]!.y * 0.7 + 0.1 };
  }
  const mapped = mapPoseToRig(rig, rig.reference, target);
  assertLengths(rig, mapped);
  assert.ok(mapped.leftWrist.y < mapped.leftElbow.y, 'left forearm follows the upward video direction');
  assert.ok(mapped.rightKnee.x > mapped.rightHip.x, 'right leg bends toward the video knee');
  close((mapped.leftHip.x + mapped.rightHip.x) / 2, (target.leftHip!.x + target.rightHip!.x) / 2 * 200);
});

test('uncertain or degenerate endpoints freeze bone direction while preserving attachment', () => {
  const rig = buildRig(photoPose(), 200, 400);
  const target = photoPose();
  target.leftWrist = { x: 0.99, y: 0.01, confidence: 0.1 };
  target.rightWrist = { ...target.rightElbow! }; // A zero-length detected forearm.
  target.leftElbow = { x: 0.15, y: 0.3 };
  const mapped = mapPoseToRig(rig, rig.reference, target);
  assertLengths(rig, mapped);
  const oldLeft = vector(rig.reference.leftElbow, rig.reference.leftWrist);
  const nextLeft = vector(mapped.leftElbow, mapped.leftWrist);
  close(nextLeft.x, oldLeft.x); close(nextLeft.y, oldLeft.y);
  const oldRight = vector(rig.reference.rightElbow, rig.reference.rightWrist);
  const nextRight = vector(mapped.rightElbow, mapped.rightWrist);
  close(nextRight.x, oldRight.x); close(nextRight.y, oldRight.y);
  assert.ok(!reliable({ x: NaN, y: 1 }));
  assert.ok(!reliable({ x: 0.5, y: 0.5, confidence: NaN }));
});

test('losing the complete pose retains the prior rig without NaNs or movement', () => {
  const rig = buildRig(photoPose(), 200, 400);
  const mapped = mapPoseToRig(rig, rig.reference, {});
  for (const name of JOINT_NAMES) {
    close(mapped[name].x, rig.reference[name].x);
    close(mapped[name].y, rig.reference[name].y);
  }
});

test('geometric part identities and drawing order are stable in mirrored references', () => {
  const pose = photoPose();
  const mirrored = Object.fromEntries(JOINT_NAMES.map((name) => [name, { x: 1 - pose[name]!.x, y: pose[name]!.y }])) as Pose;
  const normalRig = buildRig(pose, 200, 400);
  const mirroredRig = buildRig(mirrored, 200, 400);
  for (const name of ['leftForearm', 'rightForearm', 'leftShin', 'rightShin'] as const) {
    const bone = LIMB_BONES.find((item) => item.name === name)!;
    const a = normalRig.reference[bone.from]; const b = normalRig.reference[bone.to];
    const sample = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    assert.equal(classifyPart(normalRig, sample), name);
    assert.equal(classifyPart(mirroredRig, { x: 200 - sample.x, y: sample.y }), name);
  }
  assert.equal(classifyPart(normalRig, { x: 100, y: 145 }), 'torso');
  assert.equal(classifyPart(normalRig, { x: 100, y: 42 }), 'head');
  assert.deepEqual(PART_ORDER, ['leftThigh', 'leftShin', 'rightThigh', 'rightShin', 'torso', 'leftUpperArm', 'leftForearm', 'rightUpperArm', 'rightForearm', 'head']);
});

test('partition retains only supplied foreground and respects mask sampling and alpha', () => {
  const rig = buildRig(photoPose(), 20, 40);
  const mask = { data: new Float32Array([0, 1, 0.5, NaN]), width: 2, height: 2 };
  const partition = partitionMask(rig, mask);
  assert.equal(partition.labels.length, 800);
  assert.equal(partition.alpha[0], 0);
  assert.equal(partition.labels[0], 255);
  assert.equal(partition.alpha[15], 255);
  assert.notEqual(partition.labels[15], 255);
  assert.equal(partition.alpha[30 * 20], 128);
  assert.equal(partition.alpha[30 * 20 + 15], 0);
  assert.equal(maskProbability({ data: new Uint8Array([255]), width: 1, height: 1 }, 2, 2, 20, 40), 1);
  assert.throws(() => partitionMask(rig, { data: new Float32Array(3), width: 2, height: 2 }), /dimensions/);
});

test('bad reference anchors and collapsed limbs are rejected, with an optional nose fallback', () => {
  const missing = photoPose(); delete missing.leftWrist;
  assert.throws(() => buildRig(missing, 200, 400), /leftWrist/);
  const collapsed = photoPose(); collapsed.leftElbow = { ...collapsed.leftShoulder! };
  assert.throws(() => buildRig(collapsed, 200, 400), /leftUpperArm/);
  const uncertain = photoPose(); uncertain.rightHip!.confidence = 0.1;
  assert.throws(() => buildRig(uncertain, 200, 400), /rightHip/);
  const noNose = photoPose(); delete noNose.nose;
  const rig = buildRig(noNose, 200, 400);
  assert.ok(Number.isFinite(rig.reference.nose.x));
  assert.ok(rig.reference.nose.y < rig.shoulderCenter.y);
});

test('the constant stage fit frames the person rather than the whole photograph', () => {
  const alpha = new Uint8Array(640 * 480);
  for (let y = 80; y < 380; y++) for (let x = 240; x < 400; x++) alpha[y * 640 + x] = 255;
  const bounds = foregroundBounds({ width: 640, height: 480, alpha, labels: new Uint8Array(640 * 480) });
  assert.deepEqual(bounds, { x: 240, y: 80, width: 160, height: 300 });
  const { scale, offset } = fitStage(bounds, { width: 600, height: 500 });
  close(bounds.height * scale, 400);
  close((bounds.x + bounds.width / 2) * scale + offset.x, 300);
  close((bounds.y + bounds.height / 2) * scale + offset.y, 250);
  assert.throws(() => foregroundBounds({ width: 1, height: 1, alpha: new Uint8Array(1), labels: new Uint8Array(1) }), /foreground person/);
});

test('fingertips beyond an overhead wrist belong to the forearm, not the broad torso', () => {
  const pose = photoPose();
  pose.leftShoulder = { x: 0.518, y: 0.348 };
  pose.rightShoulder = { x: 0.455, y: 0.346 };
  pose.leftElbow = { x: 0.568, y: 0.335 };
  pose.leftWrist = { x: 0.560, y: 0.275 };
  pose.leftHip = { x: 0.490, y: 0.486 };
  pose.rightHip = { x: 0.472, y: 0.486 };
  pose.nose = { x: 0.486, y: 0.296 };
  const rig = buildRig(pose, 640, 480);
  for (const point of [{ x: 354, y: 111 }, { x: 350, y: 115 }, { x: 357, y: 112 }]) {
    assert.equal(classifyPart(rig, point), 'leftForearm');
  }
});

test('tiny detached noise is removed while connected limbs and nearby disconnected hands remain', () => {
  const rig = buildRig(photoPose(), 100, 200);
  const data = new Float32Array(100 * 200);
  for (let y = 50; y <= 105; y++) for (let x = 40; x <= 60; x++) data[y * 100 + x] = 1;
  const stroke = (a: Point, b: Point): void => {
    for (let step = 0; step <= 100; step++) {
      const x = Math.round(a.x + (b.x - a.x) * step / 100);
      const y = Math.round(a.y + (b.y - a.y) * step / 100);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) data[(y + dy) * 100 + x + dx] = 1;
    }
  };
  stroke(rig.reference.rightShoulder, rig.reference.rightElbow);
  stroke(rig.reference.rightElbow, rig.reference.rightWrist);
  data[2 * 100 + 2] = 1; data[2 * 100 + 3] = 1; // Tiny, far from every joint.
  data[104 * 100 + 18] = 1; data[105 * 100 + 18] = 1; // Small hand, close to the rig.
  for (let y = 180; y < 186; y++) for (let x = 5; x < 12; x++) data[y * 100 + x] = 1;
  const partition = partitionMask(rig, { data, width: 100, height: 200 });
  assert.equal(partition.removedNoisePixels, 2);
  assert.equal(partition.alpha[2 * 100 + 2], 0);
  assert.equal(partition.labels[2 * 100 + 2], 255);
  assert.equal(partition.alpha[104 * 100 + 18], 255, 'nearby hand is not discarded just because it is disconnected');
  assert.equal(partition.alpha[80 * 100 + 72], 255, 'connected arm remains intact');
  assert.equal(partition.alpha[182 * 100 + 8], 255, 'larger disconnected components are not blanket-removed');
});

test('mirroring asymmetric motion swaps limb actions without crossing fixed attachments or losing confidence', () => {
  const rig = buildRig(photoPose(), 200, 400);
  const target = photoPose();
  target.nose = { x: 0.47, y: 0.12, confidence: 0.81 };
  target.leftElbow = { x: 0.23, y: 0.22, confidence: 0.9 };
  target.leftWrist = { x: 0.23, y: 0.04, confidence: 0.87 };
  target.rightElbow = { x: 0.75, y: 0.44, confidence: 0.73 };
  target.rightWrist = { x: 0.86, y: 0.57, confidence: 0.62 };
  const mirrored = mirrorPose(target);
  assert.equal(mirrored.leftWrist!.confidence, 0.62);
  assert.equal(mirrored.rightWrist!.confidence, 0.87);
  close(mirrored.nose!.x, 0.53); assert.equal(mirrored.nose!.confidence, 0.81);
  const original = mapPoseToRig(rig, rig.reference, target);
  const mapped = mapPoseToRig(rig, rig.reference, mirrored);
  assertLengths(rig, mapped);
  for (const name of JOINT_NAMES) {
    const counterpart = name.startsWith('left') ? `right${name.slice(4)}`
      : name.startsWith('right') ? `left${name.slice(5)}` : name;
    close(mapped[name].x, rig.width - original[counterpart as keyof JointPositions].x);
    close(mapped[name].y, original[counterpart as keyof JointPositions].y);
  }
  assert.ok(mapped.leftElbow.x < mapped.leftShoulder.x, 'left arm remains outside its fixed left shoulder');
  assert.ok(mapped.rightElbow.x > mapped.rightShoulder.x, 'right arm remains outside its fixed right shoulder');
  assert.ok(mapped.rightWrist.y < mapped.rightElbow.y, 'the mirrored right arm receives the raised left-arm action');
  assert.ok(mapped.leftWrist.y > mapped.leftElbow.y, 'the mirrored left arm receives the lowered right-arm action');
  const sparse: Pose = { leftWrist: { x: 0.23, y: 0.31, confidence: 0.1 } };
  const sparseMirror = mirrorPose(sparse);
  assert.deepEqual(Object.keys(sparseMirror), ['rightWrist']);
  close(sparseMirror.rightWrist!.x, 0.77);
  assert.equal(sparseMirror.rightWrist!.confidence, 0.1);
  assert.deepEqual(sparse.leftWrist, { x: 0.23, y: 0.31, confidence: 0.1 }, 'input is not mutated');
});

test('a symmetric reference remains in its rest pose when motion is mirrored', () => {
  const pose = photoPose();
  const rig = buildRig(pose, 200, 400);
  const mirrored = mapPoseToRig(rig, rig.reference, mirrorPose(pose));
  assertLengths(rig, mirrored);
  for (const name of JOINT_NAMES) {
    close(mirrored[name].x, rig.reference[name].x);
    close(mirrored[name].y, rig.reference[name].y);
  }
});
