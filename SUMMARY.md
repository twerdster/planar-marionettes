# Puppify / Planar Marionettes: current maintenance context

Read this file, then SKILL.md, README.md and linked implementation/validation guides.

## Original project and preservation

Project by Elad Richardson and Gil Ben-Shachar, supervised by Anastasia Dubrovina and Aaron Wetzler. Preserve the official figure and recovered ten-page report bytes, PROVENANCE.json and separate 2016 listing/2015–16 award dates. Original code, trained model and final presentation remain missing.

## Current work — 2026-11-17

The new browser implementation, unchanged here, uses pinned self-hosted MediaPipe pose/whole-person inference, geometric ten-part photographic cutouts and Canvas joint posing/video motion. The deployed page was rechecked on 2026-11-17 with actual model inference, photographic puppet creation and transparent PNG export. Old detailed entrypoint remains updated/DETAILS.md.

Aaron requested concise natural README prose and a runnable demo in each Updated section. A real tools-disabled Claude review and follow-up inform the wording; factual suggestions are checked against source and records. The previous full README is preserved as PROJECT_RECORD.md. Existing updated-guide anchors remain available; lengthy implementation/recovery records are linked rather than repeated in the main README.

## Checks and maintenance

Use Node.js 22.12+, npm ci, npm test, npm run build and relevant real-model browser checks for runtime changes. Keep models/runtime self-hosted, worker isolation, CSP transport restriction and source/vendor hashes. Mask is not anatomical part segmentation; crossed/hidden limbs, layering and missing texture remain limits. Preserve MIT new-code, Apache model/runtime and CC BY-SA example media boundaries. Do not equate modern output with historical Caffe/OpenCV/D3 execution. Physical phones, Safari and GPU inference remain unverified.

New static demonstration checks are in updated/demo/VALIDATION.json when present. Actual Chrome desktop/390-pixel interactions were checked; a narrow viewport is not a physical device. No hardware, live microphone/camera recognition or cross-browser coverage is added. Review and synchronize SUMMARY.md and SKILL.md before every commit. Keep private evidence, account details and machine paths outside the repository.
