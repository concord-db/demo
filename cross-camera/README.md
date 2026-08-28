# Concord interactive demo

An inference-free, static replay of the cross-camera vehicle association example
from **Concord: A Video Relational Algebra for Cross-Modal Query Optimization**.

The site compares:

- the semantic `Reduce → Unnest` query, which asks one MLLM to discover and
  associate vehicles across both clips; and
- the O3 `Detect → Track → Join` rewrite, whose intermediate relations can be
  inspected one operator at a time.

The deployed browser application never runs a model and does not require an API
key. It only reads versioned MP4 and JSON artifacts.

The live site currently includes **one** recorded example: cross-camera vehicle
association. Other paper case studies are reserved in
`src/examples/registry.ts` but are not on the website yet.

## Local development

Run these from this `cross-camera/` directory:

```bash
npm install
npm run dev
```

Verification:

```bash
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

## Recorded artifact format

Each example is registered in `src/examples/registry.ts` and points to a
versioned manifest under `public/examples/<slug>/manifest.json`. The manifest
contains provenance, cameras, artifact paths, recorded-run metadata, and frozen
publication metrics. Data files use normalized browser-safe records for:

- frame detections and boxes;
- camera-local tracks, centroid paths, and per-frame boxes;
- scored join candidates and one-to-one resolution decisions;
- semantic and optimized cross-camera trajectories; and
- adjudicated reference trajectories.

The cross-camera assets were exported from
[`chanwutk/mmds`](https://github.com/chanwutk/mmds/tree/case_study_1_optimizations).
The two source clips are the first five synchronized seconds of the I24V
highway2/highway3 feeds.

## Regenerating the replay

This is the only step that performs inference. It requires a local MMDS checkout,
its `uv` environment, the I24V source MP4s, `ffmpeg`, and `GEMINI_API_KEY`.

```bash
cd /path/to/mmds
uv run python /path/to/demo/scripts/export_cross_camera.py \
  --mmds /path/to/mmds
```

The exporter:

1. transcodes compact five-second, H.264 browser assets;
2. materializes detection, tracking, candidate-join, resolution, and trajectory
   records;
3. executes the semantic baseline once and records outputs and usage; and
4. writes source commit, model, timestamp, and schema provenance.

Fresh-run metrics remain separate from the paper's frozen Table 3 values because
model versions and nondeterministic inference can change outputs.

## Adding an example

The website still ships only the cross-camera replay. To add another case study,
create `public/examples/<slug>/manifest.json` plus its static assets, then add
one entry to `src/examples/registry.ts`. The application shell and GitHub Pages
deployment need no model-specific changes.

## Deployment

This demo ships as the `/cross-camera/` section of the combined Concord site.
The repository-root workflow `.github/workflows/deploy-pages.yml` builds it with
a `/demo/cross-camera/` base path and deploys it alongside the
event-localization demo. See the root `README.md` for the full site layout.

## Data attribution

Traffic footage is from the I24V/I-24 MOTION dataset:

> Gloudemans et al. “So You Think You Can Track?” WACV 2024.

See <https://i24motion.org/data> for the full dataset and access terms.
