# Maintaining Puppify / Planar Marionettes

Read SUMMARY.md first, then this file, README.md and PROVENANCE.json before changing project claims.

## Preserved record

Keep assets/project-preview.png and docs/report.pdf byte-exact against their recorded SHA256 hashes. The historical figure is the official lab pipeline illustration, not a newly executed result. Preserve the students Elad Richardson and Gil Ben-Shachar and supervisors Anastasia Dubrovina and Aaron Wetzler. Record name variants in provenance, without propagating the GIP surname typo into canonical attribution.

Original source, historical models and binaries are not included. The separate updated/browser tree contains new 2026 code and its explicitly attributed third-party pose model/runtime. The unchanged 10-page report was recovered from an archived official URL; its metadata creation date is 2015-11-18, separate from the official 2016 project/award year. Current report/deck URLs returned HTTP 403. The archived deck URL contained an unrelated one-slide notice; that file remains excluded. The actual final presentation is not recovered. Never substitute documents from a different project or relabel new code as recovered student work. Do not infer an implementation language, supported platform, model architecture, performance number or installation procedure from the diagram alone.

## Documentation and validation

Use concrete technical descriptions grounded in primary project/award pages and the recovered report. Report-stated details such as Caffe, FashionPose, C++/OpenCV and D3 may be cited as historical descriptions; do not infer versions or supported environments beyond what the report states. Preserve dates and award scope; being one of the winners does not establish a particular ranking. Keep no-source and unavailable-document status distinct. Do not add a New! modern-port callout unless working updated software is actually added with its own evidence.

Before committing, reread/synchronize this file and SUMMARY.md. Validate PROVENANCE.json, local Markdown/image paths, SVG syntax and image and report SHA-256 hashes. Render the README and inspect the figure/captions. Check external links and record unavailable resources honestly. Inspect newly staged files; do not publish raw correspondence, personal contact details, credentials, signing material or private local paths. The historical record has no software build. The separately updated browser application must be type-checked, tested, bundled and validated as described below.

No blanket software, data or image license is assigned. Keep historical-material terms separate from any later maintainer implementation. If new source arrives, review its provenance, embedded/raster contents and applicable terms before publication; preserve originals and label any sanitization or adaptation.

Only record Claude review when an actual invocation completed, and check factual suggestions against the primary sources. Editorial/static checks add no runtime evidence. Push normally using the existing Aaron Wetzler Git identity; do not rewrite published history without explicit authorization.

## Browser implementation workflow

Keep updated/browser source, pinned model/runtime manifest, examples and notices separate from the historical report and figure. The root README links the updated guide through the New! badge and exact Updated and ported for modern hardware label; the updated guide must prominently state that this is a new implementation, not recovered student code. Keep setup, changes, results and limitations there.

The app uses worker-based MediaPipe pose and a whole-person mask followed by a geometric body-part partition, joint-overlap copies and Canvas 2D transforms. Do not describe the mask as anatomical part segmentation, infer occluded texture, or claim the historical Caffe/OpenCV/D3 chain was executed. Preserve the explicit new-code authorship and scoped MIT/Apache/CC-BY-SA/historical rights boundaries.

Run `npm ci`, `npm test`, `npm run build` and the real-media Playwright checks from updated/browser. Verify bundled asset hashes and historical report/figure hashes. Inspect desktop and phone layouts, actual model inference, body cutouts, joint edits/drag/reset, transparent PNG, video motion and frame-to-reference, replacement/cancellation/error paths, transient model-load failure followed by real inference recovery, mirrored limb-label handling, and absence of runtime external requests. A phone viewport is not a physical-phone or Safari test. Math/test counts are scoped checks, not model accuracy, general device support or historical result reproduction.

Build/deploy via .github/workflows/browser.yml and GitHub Pages; verify actual successful Linux checks, deployment and public assets. Keep modern source and evidence in updated/, original source_files=0, and recovered original materials unchanged. For generated recordings and larger private scratch, verify the attached AgentSSD and use its task directory; keep package installations/build trees on the native filesystem. Before each commit review and synchronize this file and SUMMARY.md, inspect staged new files, and record actual Claude reviews only after completion.
