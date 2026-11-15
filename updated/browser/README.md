# Puppify browser application

A new browser implementation by Aaron Wetzler, based on the photograph-to-planar-puppet workflow described by Elad Richardson and Gil Ben-Shachar in the [original report](../../docs/report.pdf). The original application source, model weights and executable were not recovered. This application uses a different pose model, segmentation approach and renderer; its output is not a reproduction of the historical implementation.

## Setup

Requirements: Node.js **22.12 or later** with npm, and a browser supporting Web Workers, OffscreenCanvas, WebAssembly, Canvas 2D and decoding for your chosen media. See [recorded validation](docs/VALIDATION.md) for the browsers actually checked; requirements alone do not establish compatibility on every device.

From this repository's root:

```sh
cd updated/browser
npm ci
npm run dev
```

Open the URL printed in the terminal. Serve the app through Vite or another HTTP server; opening `index.html` directly as a `file:` URL does not provide the required worker/module environment. The first inference loads the included model and WebAssembly runtime. GPU inference is attempted, with CPU fallback if GPU initialization or inference fails; a detected software GPU renderer selects CPU directly. Actual speed depends on the browser and hardware.

## Make a puppet from a photograph

1. Choose a photo or select **Use example photo**. The interface accepts images up to 25 MB and processes them at a maximum side length of 1,100 pixels. Choose one person, facing forward, with visible arms and legs; a clear background and separated limbs help.
2. Wait for joint detection. Select **Adjust joints** if a dot needs correction, then drag it on the source photograph. The whole-person mask is retained; adjusting joints changes the geometric part assignment, not the model's foreground prediction.
3. Select **Build puppet**. The foreground becomes ten transparent photo cutouts: head, torso, two upper arms, two forearms, two thighs and two shins. The stage fits the reference foreground once, so its size does not change as the pose moves.
4. With **Show joints** enabled, drag a wrist or ankle to solve its two-link chain. Drag an elbow or knee to reposition that limb; dragging a shoulder or hip translates the entire puppet. The nose control changes the head angle. **Reset pose** restores the reference joint positions.
5. Select **Save image** for a transparent, 1,200 × 1,400 PNG without joint overlays. This saves the current pose using the stage framing; parts moved beyond that frame are cropped. There is no video/GIF export.

Under **Cutout settings**, raising the person-mask threshold trims uncertain boundary pixels. Rebuild to apply a changed threshold or corrected reference joints. It cannot restore a body part that was hidden in the reference photograph.

## Drive it with a video

Build a puppet, then choose a video or select **Try example motion**. Play and pause with the video's controls. Motion changes the existing photo cutouts; it does not replace their textures with incoming video pixels.

To begin with a video instead, choose the file, pause or seek to a clear front-facing frame and select **Use this frame as the photo**. Detect/correct its joints, build the puppet and play the clip. **Mirror motion** reverses the video's horizontal coordinates and swaps the detected left/right joint labels so the rig attachments stay consistent. Dragging a puppet joint or resetting the pose pauses motion.

The interface accepts video files up to 200 MB. Frames used for pose inference have a maximum side length of 800 pixels. Decoding and inference run one frame at a time; playback can skip inference frames when processing is slower than the video. There is no guaranteed frame rate. Hidden or uncertain endpoints keep their last reliable bone direction, and frames without a detected person keep the previous pose. This limits disruption; it does not infer the person's hidden movement. The app has file-video input, not webcam capture.

The supplied example is real recorded human motion: a photograph extracted from **Jumping jacks and burpees** and a 2.7-second excerpt from the same recording, by Taco Fleur / Cavemantraining. Its [notice](public/examples/NOTICE.txt) and [provenance](public/examples/MEDIA_PROVENANCE.json) give the source, transformations, timestamps, hashes and CC BY-SA 4.0 terms. It is a demonstration fixture without independent ground-truth labels.

## How it works

`src/vision.worker.ts` runs the pinned MediaPipe Pose Landmarker Full model and copies the detected landmarks and optional whole-person mask out of the native result before closing it. `src/main.ts` maps thirteen landmarks to the rig. Reference-image inference requests a foreground mask; subsequent video inference requests pose only.

`src/puppet.ts` assigns foreground pixels to head/torso/limb segments using distances to the reference skeleton and a torso polygon. Forearm regions extend beyond the wrist to include the observed hand. Tiny detached mask regions far from the rig are pruned; nearby or larger disconnected regions are retained. This is a new geometric heuristic: **the mask is not a learned body-part segmentation**. Small overlaps around connected joints copy observed source pixels to conceal some hinge seams. They do not synthesize hidden texture. Canvas 2D rotates each cutout around its joint; the torso remains rigid. Video directions are mapped to the photograph's fixed bone lengths, and uncertain endpoints retain their previous direction.

The historical report instead describes Caffe/FashionPose joint estimation, reverse ensembling, skin-based wrist refinement, generated scribbles, C++/OpenCV segmentation using Dijkstra/FIGTree, and a D3 force-graph puppet. None of that source was recovered. These new modules replace those components; they are not wrappers around original student code. Video motion transfer is an additional workflow.

Crossed/overlapping limbs, loose clothing, side views and occluded feet or hands can produce incorrect crops. The fixed draw order cannot determine which arm should be in front. A two-dimensional cutout cannot rotate convincingly out of the image plane or reveal the back of a limb. Joint correction improves the anchors but does not resolve all body-part ambiguity. There is no numerical comparison with the original system.

## Local processing and asset integrity

Selected photographs and videos are decoded in the browser and are not uploaded by this application. Inference runs in a worker. Runtime model, WASM and application requests are served from the same origin. The worker blocks external fetch/XHR transport before importing the pinned SDK. The page's `connect-src 'self'` CSP applies to the main document; it does not govern the separately loaded worker. The worker's guard is the SDK transport control on GitHub Pages, where this app cannot set a worker response CSP header. See [MDN's worker CSP guidance](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy). No cloud inference, runtime CDN, API key, account or remote font is needed. Following a source/credit link opens that external site separately. The integration's controls apply to this pinned version; they do not imply that every upstream SDK release has identical behavior.

The model/runtime are checked in. Verify their hashes with:

```sh
node scripts/vendor-vision.mjs --check
```

After `npm ci`, `node scripts/vendor-vision.mjs` can restore missing assets from the pinned npm package and official upstream URLs; it rejects bytes that differ from the manifest. That maintenance command may download files. See [MODEL_NOTICES.md](MODEL_NOTICES.md) for versions, licenses, sources and the SDK logging integration.

## Build, test and serve

```sh
npm test
npm run build
npm run preview
```

`npm test` runs Node's test runner through TSX. The thirteen puppet tests exercise reachable/unreachable inverse kinematics, finite behavior at coincident endpoints, reference bone-length preservation, weak/degenerate endpoint freezing, total pose loss, mirrored part identities, mask probabilities/background handling, invalid reference poses, fixed foreground-based stage fitting, overhead-hand assignment, conservative mask-fragment removal and mirrored motion with left/right label exchange. These are geometry/data checks; they do not test the pose model's accuracy or every cutout produced by the app.

For the browser suite, keep a built preview running in a separate terminal on the port expected by Playwright:

```sh
npm run preview -- --port 18791 --strictPort
```

Then run:

```sh
npm run test:browser
```

The local Playwright configuration uses installed Google Chrome; CI uses Playwright's bundled Chromium. CI environments must install that browser with `npx playwright install --with-deps chromium`. See [the validation record](docs/VALIDATION.md) for executed tests, browser versions, actual photographic results and limitations. A passing build or smoke test is not a general accuracy or performance benchmark.

The production output is `dist/`. Serve that directory as a static site over HTTPS, or use localhost during development. Vite uses relative asset URLs, so the app can be hosted below a path prefix. Preserve the model/WASM files, worker bundle, content security policy, notices and example-media attribution when deploying. `npm run preview` serves the built files for local inspection.

## Attribution and licenses

New application source and associated documentation are by Aaron Wetzler, 2026, under the scoped [MIT license](LICENSE). MediaPipe's SDK/runtime/model retain [Apache 2.0 and upstream notices](MODEL_NOTICES.md). Example media and their adaptations retain [CC BY-SA 4.0](public/examples/NOTICE.txt). The recovered historical report and project figure retain their existing rights; this license does not relicense them or imply student authorship of the new implementation.
