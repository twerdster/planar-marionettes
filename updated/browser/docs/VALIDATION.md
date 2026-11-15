# Browser implementation validation

Recorded on **2026-11-15** for the new application in `updated/browser`. This is not validation of the missing historical Puppify source or a reproduction of its results.

## Local build and geometry checks

On macOS 15.1.1 arm64, Node.js 23.11.0 and npm 10.9.2 (the declared Node.js 22.12 minimum was not separately exercised):

- `npm test`: **13 passed**, no failures. These are focused geometry/data checks for inverse kinematics, fixed reference lengths, uncertain/degenerate detections, mirrored references, mask assignment, raised hands, conservative fragment cleanup, fixed stage fitting and mirrored motion with label exchange.
- `npm run build`: original-material and vendored-asset hash checks, application TypeScript checking and production bundling passed.
- The report and historical preview remain byte-exact. Their SHA-256 values are checked by `scripts/check-originals.mjs`; the model/runtime files are checked against the vendoring manifest.

The tests exercise specified operations. They do not establish pose accuracy, general correctness or equivalence to the historical Caffe/OpenCV/D3 chain.

## Real browser checks

Playwright ran the production build in installed **Google Chrome 157.0.8103.51** on that Mac. Eight flows ran at both **1440 × 1100** and **390 × 844**, the latter with touch/mobile emulation: **16 passed**, zero failures, skips or flaky outcomes, in **50.8 seconds**. Source and production-bundle hashes were unchanged across the run. The [machine-readable record](browser-results-2026-11-15.json) lists each result.

| Flow, run at both sizes | Observed behavior |
| --- | --- |
| Photo → puppet → pose → PNG | Actual model inference, ten photographic cutouts, mouse/touch dragging, reset, transparent 1200 × 1400 PNG export |
| Correct joints and rebuild | Reference-joint changes applied; foreground count decreases from 10,971 to 10,644 pixels at threshold 0.50 → 0.60 on the same corrected reference |
| Example motion and frame-to-photo | Real video advances; actual inferred poses move the photograph's rig; reset pauses motion and the pose remains reset after stopping; a paused frame can become the reference |
| Corrupt image / no-person image | Clear errors, stale stage/export removed, subsequent valid photo recovers |
| Replace photo during model loading | Old loading worker terminated; replacement selection remains authoritative |
| No-person video | Genuine negative model results hold the previously built pose |
| Model-load failure and retry | On the tested software-renderer/direct-CPU path, one HTTP 503 causes a handled fatal model error; a new photo selection loads the real model and builds a puppet without page reload |
| Responsive layout | No horizontal page overflow before or after photo processing |

The test observer records real worker responses; landmarks, masks and model bytes are not mocked. The cancellation test delays the real local model request. The recovery test returns one intentional HTTP 503, then permits genuine model bytes; it does not substitute model results. The positive reference produces 33 landmarks and a whole-person mask; this run used the **CPU** delegate. All sixteen browser contexts recorded **zero external requests** and **zero uncaught page errors**. The exported PNGs were decoded and visually inspected. Both sizes produced the same 447,789-byte file, SHA-256 `b1724731c6c4086d42f80713d92b57b96e864d9b33f4fa16ca2b5cd97c1a4952`.

Initial integration checks of `VisionClient`, before the lifecycle revisions, exercised worker cancellation/recovery, IMAGE/VIDEO mode switching and caller-owned bitmap retention. Software-renderer detection selected CPU directly; forced hardware-GPU initialization/inference failure branches were not exercised. A separate 62-second idle observation after real photo inference on the final production build recorded zero external requests and zero uncaught page errors (Chrome 157, CPU; recorded at 18:38 UTC on 2026-11-15). These observations support the pinned integration's same-origin transport controls; they do not make a claim about other SDK versions.

## Input and evidence scope

The positive fixture is a real photograph and a 2.7-second jumping-jack clip of **one subject in one scene**, derived from Taco Fleur / Cavemantraining's recording under CC BY-SA 4.0. [Media provenance](../public/examples/MEDIA_PROVENANCE.json) records source, timestamps, transformations and hashes. Blank image/video inputs are procedural **negative controls**, not human-motion evidence.

There are no independent ground-truth landmarks or part masks. Test counts represent user flows at two viewport sizes, not sixteen subjects or an accuracy benchmark. The example uses the same person/scene for reference and motion; it does not demonstrate arbitrary cross-subject transfer. Geometric cutouts can misassign pixels, expose gaps or layer limbs incorrectly.

The mobile run is browser emulation on a Mac. **Physical iPhone/Android devices, Safari/WebKit and hardware-GPU execution have not been validated.** File decoding and performance depend on the browser and hardware. PNG export uses the fixed stage framing; parts dragged beyond it are cropped. There is no guaranteed inference frame rate, camera workflow, video export or historical benchmark reproduction.

## Reproduce

```sh
cd updated/browser
npm ci
npm test
npm run build
npm run preview -- --port 18791 --strictPort
```

In a second terminal in `updated/browser`, run `npm run test:browser`. Local checks use installed Chrome. The [GitHub workflow](../../../.github/workflows/browser.yml) installs bundled Chromium on Ubuntu 24.04, runs the build and both suites, and deploys only after they pass. A workflow definition alone is not evidence of a successful Linux run; published run results are tracked separately.
