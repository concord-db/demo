# Concord event-localization demo

This directory contains a deterministic replay of the video-only baseline,
O1 modality substitution, and O2 cross-modal temporal candidate pushdown.
No model inference runs in the browser.

## Frozen data

The shared schema has two independently generated artifacts:

- `data/lecture-event-localization-v3.json` contains the Lecture 20 trace and
  aggregate three-lecture evaluation.
- `data/soccer-event-localization-v3.json` contains the Everton--Chelsea
  first-half trace and aggregate three-game evaluation.

Schema version 3 represents interval-valued lecture events and point-valued
soccer goals explicitly. It also associates every candidate window,
materialized clip, and clip-level prediction through stable identifiers.
Regenerate both artifacts from an MMDS checkout with:

```bash
python3 scripts/export_demo_data.py --mmds-root /path/to/mmds
python3 scripts/export_soccer_demo_data.py --mmds-root /path/to/mmds
```

Use `--check` with either command to verify that a committed artifact remains
synchronized with the frozen experiment without rewriting it.

The exported artifact records source hashes, source-time predictions,
candidate windows, transcript evidence, and the exact aggregate metrics shown
in the CIDR 2027 paper. The public soccer artifact intentionally excludes
SoccerNet broadcast media until redistribution permission is established.

## Validation

The unit suite validates the published values, operator contracts, execution
state, point/interval semantics, clip associations, media digest, and
public-path hygiene. The browser suite verifies progressive disclosure,
example switching, deferred media loading, operator-scoped video fractions,
and mobile layout:

```bash
npm install
npm test
npm run test:e2e
```
