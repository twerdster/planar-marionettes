# Local pose inference assets

This new browser implementation uses Google's MediaPipe Pose Landmarker. It does not use the unavailable original Puppify Caffe model or claim to reproduce its predictions. No model was trained for this implementation.

The npm dependency is pinned to **@mediapipe/tasks-vision 1.2.3**. Vite bundles its JavaScript into the application/worker. The unchanged module WebAssembly loader and binary are copied from that npm package into `public/vendor/vision/wasm/`. The **Pose Landmarker Full, float16, version 1** task bundle is hosted at `public/vendor/vision/pose_landmarker_full.task`. It contains `pose_detector.tflite` and `pose_landmarks_detector.tflite`. The task returns 33 normalized body landmarks and, when requested, a whole-person foreground confidence mask; it does not return semantic body-part masks. The puppet code partitions this mask separately.

The runtime and model are distributed under Apache License 2.0. Preserve [the upstream license](public/vendor/vision/LICENSE.mediapipe.txt), including its additional notice. The npm tarball contains no separate NOTICE file. A [MediaPipe maintainer explicitly confirmed the model and Web SDK licenses](https://github.com/google-ai-edge/mediapipe/issues/6306); the discussion also permits blocking outgoing SDK logging requests. The applicable [MediaPipe task/privacy notice](https://developers.google.com/edge/mediapipe/solutions/tasks#mediapipe_tasks_privacy_notice) remains an upstream reference. These terms cover the inference assets, not the separate historical report or project figure.

All runtime WASM/model requests use local, same-origin paths. The pinned SDK contains usage-logging transport code; the worker blocks external `fetch` and XMLHttpRequest transport before importing it. The main document's CSP limits `connect-src` to `'self'`, but that meta policy does not govern the separately loaded worker. Inside the worker, the fetch/XHR guard is the pinned SDK's transport boundary; other network APIs are not claimed to be sandboxed. Hosts that support custom headers can also serve the worker script with a restrictive response CSP. GitHub Pages does not supply that header here. Selected photographs and video frames are processed in the local worker. No cloud inference, runtime CDN, account, or API key is required. This is a description of this integration, rather than a claim that all MediaPipe releases lack telemetry.

[manifest.json](public/vendor/vision/manifest.json) records the exact npm version/integrity, model URL, source-license commit, byte sizes and SHA-256 hashes. Run `node scripts/vendor-vision.mjs --check` to verify the checked-in files. After `npm ci`, `node scripts/vendor-vision.mjs` restores missing files from the pinned npm package and official URLs, rejecting unexpected bytes. Updating a package, model or manifest requires an explicit review and renewed browser validation.

Sources retrieved 2026-11-15:

- [Official Pose Landmarker Web guide](https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker?tab=Web)
- [Official full model bundle](https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task)
- [Exact npm tarball](https://registry.npmjs.org/@mediapipe/tasks-vision/-/tasks-vision-1.2.3.tgz)
- [Upstream license at recorded commit](https://github.com/google-ai-edge/mediapipe/blob/02ca022d573c004c463d8c61eb3f8ce17e95a7fc/LICENSE)
- [Result/mask lifetime API](https://developers.google.com/edge/api/mediapipe/js/tasks-vision.poselandmarkerresult)
