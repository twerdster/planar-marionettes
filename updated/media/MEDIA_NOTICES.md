# Browser demonstration media

`puppify-browser-demo.gif`, `puppify-browser-demo.mp4`, and `editor.png` show the actual 2026 Puppify browser implementation using real photographic media. The recording shows the reference photo, the source-video inset, and the animated photographic cutout together.

The photographs visible in these files derive from **“[Jumping jacks and burpees](https://commons.wikimedia.org/wiki/File:Jumping_jacks_and_burpees.webm)”**, by **[Taco Fleur (Cavemantraining)](https://commons.wikimedia.org/wiki/User:Taco_fleur)**, dated 2017-11-15, licensed **[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)**. The source/license page was checked at [this revision](https://commons.wikimedia.org/w/index.php?title=File:Jumping_jacks_and_burpees.webm&oldid=1182499913). No endorsement by the creator is implied.

The reference photo is full source frame 38 (1.271 seconds). The silent 2.703-second motion input contains the first 81 source frames. The application detects a person and joints, cuts photographed parts out of the reference image, and rotates/translates those parts using joints inferred from the real motion video. The demonstration recording is cropped to the editor workspace; the GIF is downscaled and palette reduced. The screenshot is captured from the actual editor after pausing playback. No interface or successful inference output was synthesized.

These three demonstration media files, including their adaptations of the source video, are supplied under **CC BY-SA 4.0**. Preserve attribution, identify changes, link the license, and apply the same license when sharing adaptations. The [license text](../browser/public/examples/LICENSE-CC-BY-SA-4.0.txt) is included with the example inputs. This media license does not change the separate licenses for the new application code, vendored runtime/model, or historical project archive.

The eight-second recording was made on 2026-11-15 in Chrome 157 on macOS using the production build and the bundled model with its CPU delegate. The source clip loops. One actor and scene demonstrate functioning inference and cutout animation; mask errors, rigid part seams, and imperfect poses remain visible. These files do not establish pose accuracy, general robustness, phone/Safari compatibility, or GPU performance.

[MEDIA_PROVENANCE.json](MEDIA_PROVENANCE.json) records original and derived hashes, source timestamps, reviewed build hashes, capture settings, measured file sizes, and the limits of the evidence.
