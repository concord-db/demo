# Concord event-localization demo

This directory contains a deterministic replay of the video-only baseline,
O1 modality substitution, and O2 cross-modal temporal candidate pushdown.
No model inference runs in the browser.

## Frozen data

`data/event-localization-v2.json` is generated from the evaluated MMDS
artifacts. Schema version 2 separates the single Lecture 20 execution trace
from the aggregate publication evaluation and records an explicit contract for
every operator stage. Regenerate it from an MMDS checkout with:

```bash
python3 scripts/export_demo_data.py --mmds-root /path/to/mmds
```

The exported artifact records source hashes, source-time predictions,
candidate windows, transcript evidence, and the exact aggregate metrics shown
in the CIDR 2027 paper.

## Validation

The unit suite validates the published values, operator contracts, execution
state, timestamp mappings, media digest, and public-path hygiene. The browser
suite verifies progressive disclosure, deferred media loading, operator-scoped
video fractions, and mobile layout:

```bash
npm install
npm test
npm run test:e2e
```
