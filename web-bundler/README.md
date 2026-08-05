# web-bundler — standalone webpack pipeline (migration Stage 0)

Replaces `expo build:web` for the web app (see `FRONTEND_MIGRATION_PLAN.md`, Stage 0).
Builds the **unchanged** app source in the parent directory with webpack 5 on **Node 22**,
producing the same `web-build/` output contract Firebase Hosting deploys.

## Layout

-   This directory is its own npm package (lockfile v3, Node 22). It carries **only build
    tooling** — the app's runtime dependencies still come from the repo root's
    `node_modules` (installed with the pinned Node 14 / npm 6 until migration Stage 1+).
-   `webpack.config.js` — the pipeline. Entry is the same `expo/AppEntry.js` boot chain
    the old pipeline used; output filenames, `fonts/`, `static/media/`, `web/` static
    copies, and the PWA assets match the old `expo build:web` output.
-   `index.html` — the HTML template: `web/index.html` with the tokens/PWA tags the expo
    pipeline used to inject at build time already applied.
-   `static/` — assets the expo pipeline used to **generate** (PWA manifest, favicons,
    apple-touch-startup images), snapshotted as source. They win over `web/` copies on
    filename conflicts.
-   `babel.config.js` — used **only** by this pipeline (babel-loader points at it
    explicitly). The root `babel.config.js` stays for the legacy pipeline + Jest.

## Usage

```bash
cd web-bundler
nvm use 22
npm ci
npm run build          # production build → ../web-build
npm run build:analyze  # same + webpack-bundle-analyzer report
npm run dev            # dev server on http://localhost:19006 (needs ../.env)
```

## Module semantics (production parity)

`babel.config.js` compiles app + RN-family modules to **sloppy-mode CommonJS with
var-hoisted bindings** — the exact semantics metro's preset gave the legacy pipeline.
This is deliberate and load-bearing: the codebase contains implicit-global writes and
use-before-declaration that strict ES modules turn into runtime ReferenceErrors on
logged-in flows (production incident 2026-08-04). Do not remove the
transform-modules-commonjs / block-scoping plugins until an ESLint `no-undef` +
`no-use-before-define` sweep makes the code strict-clean; the cost is app-code
tree-shaking, the benefit is byte-level behavioral parity.

Env injection is unchanged from the old pipeline and happens **outside** the bundler:
CI runs `sed` over the `BEGIN-ENVS` blocks before building (`ci/replace-envs.sh` /
the inline job before_scripts); local builds read `../.env` via react-native-dotenv.
The `replacement_node_modules/` Quill/y-quill patches must be applied to the root
`node_modules` before building, exactly as before.

## CI

-   `web_bundler_cache` builds the `build_web_bundler` image (`ci/Dockerfile_web_bundler`):
    Node 22 + this package's `npm ci`, with `/app/node_modules` copied from the legacy
    base image.
-   `build_web_webpack_check` shadow-builds every web-relevant change with this pipeline
    (`allow_failure: true`). The expo pipeline remains the deployed artifact until a
    staging deploy of this output passes the parity checklist; then the deploy jobs'
    `needs` switch over and the expo pipeline can be deleted.
