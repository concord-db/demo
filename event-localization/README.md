# Concord event-localization demo

This directory contains a deterministic replay of the video-only baseline,
O1 modality substitution, and O2 cross-modal temporal candidate pushdown.
No model inference runs in the browser.

## Frozen data

`data/event-localization-v1.json` is generated from the evaluated MMDS
artifacts. Regenerate it from an MMDS checkout with:

```bash
python3 scripts/export_demo_data.py --mmds-root /path/to/mmds
```

The exported artifact records source hashes, source-time predictions,
candidate windows, transcript evidence, and the exact aggregate metrics shown
in the CIDR 2027 paper.

## Validation

```bash
node --test tests/*.test.mjs
```

The test suite validates the published values, timestamp mappings, media
digest, public-path hygiene, and the page's required interaction contracts.
