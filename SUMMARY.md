# Puppify: historical record and browser implementation

Read this file, then SKILL.md, README.md and PROVENANCE.json. Current recovery record: 2026-11-15.

## Identity and scope

Puppify - Automatic Generation of Planar Marionettes from Frontal Images is a GIP/Technion student project by Elad Richardson and Gil Ben-Shachar, supervised by Anastasia Dubrovina and Aaron Wetzler. GIP lists it under 2016. Official Technion news records it among the 2015-16 Amdocs Best Project Contest winners; the announcement is dated 2016-05-10 and ceremony 2016-07-04. Use those sources rather than inferring a rank or a later award year.

This repository preserves the 10-page original report, historical figure and factual project documentation. Original application source, historical trained models and binaries have not been recovered. Historical source status remains documentation_recovered and original source_files remains 0. Separately written 2026 browser code now lives under updated/browser; do not attribute it to the students or describe it as recovered code.

The official description gives a photograph → joint estimation/refinement → generated foreground/background scribbles → segmentation/body-part cropping → two-dimensional puppet pipeline. The report names Caffe, FashionPose training, C++/OpenCV segmentation and a D3 force-graph puppet simulation. Source, trained parameters, precise dependency versions and deployable configuration remain unavailable for this repository.

## Materials and evidence

The canonical public page is https://gip.cs.technion.ac.il/lab-projects.php?id=6. The unchanged image is assets/project-preview.png, downloaded from the image URL in the official last-projects.php listing. Its bytes/hash, dimensions, sources and retrieval date are in PROVENANCE.json. The figure was visually inspected for project relevance and any exposed contact or account data. Identifiable adults appear in this publicly posted figure; no credentials or contact details were observed. Do not identify those people without a source.

The detail page's current report and PPTX links returned HTTP 403. An Internet Archive capture supplied the correct 10-page report, whose PDF creation metadata is 2015-11-18; the official project/award year remains 2016. The archived PPTX URL resolved to an unrelated one-slide lab recruitment notice. It is excluded, and no actual final presentation has been recovered. Older award-page report/gallery links returned HTTP 404. Preserve these distinctions and never publish the unrelated presentation as project material. The official page links YouTube video RPFcZ8bozjM; no copy is hosted here.

Public GitHub repository-name searches and the public repository lists of eladrich and gilbs10 found no matching source repository on the recovery date. Their public profiles name Elad Richardson and Gil Ben-Shachar respectively. That bounded search does not prove source does not exist elsewhere. Private raw HTML/search evidence stays outside this repository; provenance preserves URLs and checks.

## Maintenance

Keep original figure bytes, attribution, source URLs, factual badges and license boundaries intact. No explicit open license for the historical material was established; no blanket license is added. The historical record remains archival. The separately documented updated/browser implementation has runnable new source, its own scoped MIT license and third-party/model/media terms.

The recovered PDF passed an independent review of all 10 rendered pages, full extracted text/metadata and all 404 internal PDF objects (object count). No redaction was identified: no credentials, private contacts, embedded files, scripts, forms or remote actions were found; its initial view action is an internal GoTo/Fit. Preserve the PDF byte-exact.

Before every commit reread and synchronize SUMMARY.md and SKILL.md, verify image and report SHA-256 hashes, relative links, JSON and Markdown rendering, and inspect newly staged files for private material. No build/package/test step exists for the historical software. Editorial review and static publication checks do not establish runtime compatibility or algorithm accuracy.

Two actual tools-disabled Claude editorial reviews completed on 2026-11-15. Useful corrections were checked against the primary sources, report metadata and independent inspection, then applied. These reviews add no software/runtime validation.

## New browser implementation (2026-11-15)

Read updated/README.md, updated/browser/README.md and the browser validation record before changing runtime claims. New TypeScript code uses a pinned, self-hosted MediaPipe Pose Landmarker Full model for 33 landmarks and a whole-person mask. A new geometric partition produces ten photographed body-part canvases. Canvas 2D renders a rigid torso and constrained limbs; photo-joint correction, direct posing, transparent PNG export, and file-video motion transfer are implemented. This is an independent alternative to the report's Caffe/FashionPose and C++/OpenCV/D3 pipeline; it is not a source port or original-results reproduction.

The top New! link uses Aaron's requested Updated and ported for modern hardware wording, while the updated guide explicitly labels this as a new implementation. Keep runtime changes, media and validation details in the updated section. The original report and figure stay byte-exact. The supplied example photo and 2.7-second real exercise clip derive from Taco Fleur/Cavemantraining under CC BY-SA 4.0; source code, model/runtime and historical materials retain separate terms. The mask provides foreground confidence, not anatomical part labels; crossed/hidden limbs, fixed layering and unobserved texture remain limitations.

Use Node.js 22.12+ and `npm ci` in `updated/browser`. `npm test` runs geometry checks, `npm run build` verifies original/vendor assets, type-checks and bundles the static application; `npm run preview` serves `dist`. Playwright uses installed Chrome locally and bundled Chromium on Linux CI. The browser workflow is configured to deploy the checked dist through GitHub Pages after successful Linux checks; verify the actual run and deployment before claiming public availability. Runtime inference stays in a worker and all model/runtime files are self-hosted; external SDK fetch/XHR transport is blocked. No training, cloud inference or account is required.

Work requiring native filesystem semantics (repository, node_modules/build tools) stays on the Mac's native filesystem. Large private captures and test-media recovery use /Volumes/AgentSSD/agent-work/puppify-browser-2026-11-15 on the verified AgentSSD exFAT volume; no original project was moved and global caches were not relocated. Private review/QA metadata are under ~/.codex/puppify-browser-2026-11-15 and the separate review directory.

Validation of the reviewed browser build passed on 2026-11-15: 13 focused geometry/data checks and 16 real-model Chrome user-flow checks (eight flows at desktop and mobile-emulated sizes). Local CPU execution, same-origin runtime requests, model-load failure recovery and actual video-driven photographic cutouts were observed. See updated/browser/docs/VALIDATION.md and its JSON for counts, environment and limitations. Physical phones, Safari/WebKit, hardware GPU execution and historical accuracy remain unverified. Two actual tools-disabled Claude source/documentation reviews completed. The first identified mirror label exchange, fatal-client recovery, CSP scope and provenance qualifications; the fixes were checked against code and regression results.
