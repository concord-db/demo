# Concord interactive artifacts

A single website hosting the recorded demos for **Concord: A Video Relational
Algebra for Cross-Modal Query Optimization** (CIDR 2027). Neither demo runs a
model in the browser or requires an API key — both replay versioned MP4 and JSON
artifacts exported from [`chanwutk/mmds`](https://github.com/chanwutk/mmds).

| Path | Demo | Rewrites | Stack |
| --- | --- | --- | --- |
| `/` | Landing page | — | Static HTML/CSS |
| `/event-localization/` | Lecture event localization | O1 modality substitution, O2 temporal candidate pushdown | Vanilla JS, no dependencies |
| `/cross-camera/` | Cross-camera vehicle association | O3 detect → track → join | React + Vite + TypeScript |

Each demo keeps its own build, tests, and data exporter, so they can be worked
on independently. See `event-localization/README.md` and
`cross-camera/README.md` for details on the artifacts and how to regenerate
them.

## Local development

The landing page and the event-localization demo are static files. Serve the
repository root and open <http://localhost:8000/>:

```bash
python3 -m http.server 8000
```

Note that `/cross-camera/` is not available this way, since it needs a build.
Run it on its own dev server instead, which gives you hot reload:

```bash
cd cross-camera
npm install
npm run dev
```

### Previewing the whole site

To check the landing page and both demos together, exactly as deployed, build
the cross-camera app under its subpath and assemble the site:

```bash
./scripts/serve-site.sh
```

This writes the combined site to `site/` (gitignored) and serves it at
<http://localhost:8000/>.

## Validation

```bash
cd event-localization && node --test tests/*.test.mjs
cd cross-camera && npm test && npm run build
```

The cross-camera end-to-end suite additionally needs a browser:

```bash
cd cross-camera
npx playwright install chromium
npm run test:e2e
```

## Deployment

`.github/workflows/deploy-pages.yml` tests both demos, builds the cross-camera
app with a `/concord-demo/cross-camera/` base path, assembles the landing page
and both demos into one directory, and deploys it to GitHub Pages on every push
to `main`.

## Data attribution

- Event localization: MIT OpenCourseWare 8.03SC, Fall 2016.
- Cross-camera: I24V/I-24 MOTION dataset — Gloudemans et al., "So You Think You
  Can Track?", WACV 2024. See <https://i24motion.org/data> for access terms.
