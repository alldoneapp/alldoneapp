# Dependency Update Plan

_Assessed 2026-08-04. Audit baseline: root app 253 vulnerabilities (30 critical / 96 high),
functions 66 (8 critical / 29 high), cloudflare email worker 6 (5 high, all in the wrangler
dev tree)._

## Current state

The repo is effectively three codebases with very different update economics:

| Area                       | Stack                                                                     | Updatability                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Root app                   | Expo 36 / RN 0.61 / React 16.9, pinned Node 14.21.3 + npm 6 (lockfile v1) | Frozen — almost every fix needs majors that don't exist for this Expo generation. Migration project, not `npm update`. |
| `functions/`               | Node 22, Functions v2, lockfile v3                                        | Fully updatable. This is where the real server-side exposure lives.                                                    |
| `cloudflare/email-worker/` | Node 20, wrangler                                                         | Trivial to keep current.                                                                                               |

Where the risk actually is:

-   **Functions (server-side, highest exposure)**: criticals in `handlebars` (in-range fix),
    `fast-xml-parser`, `basic-ftp`, `form-data`/`request`/`tar` (all via the runtime
    `firebase-tools` dependency), `protobufjs` (via the stale direct
    `@google-cloud/firestore@^4.2.0`); highs in `twilio`'s old `axios`/`jsonwebtoken` and `ws`.
-   **Root app**: most findings are build tooling (Expo/webpack/Babel CLIs). Real runtime
    exposure in the shipped web bundle: `dompurify` (critical, via the Quill/delta HTML chain),
    `firebase@8.10.1` client SDK, crypto polyfills (`elliptic`, `browserify-sign`).
-   **Email worker**: all findings in `wrangler`/`miniflare` dev tree.

## Phase 0 — safe, immediate (DONE 2026-08-04)

1. **Email worker** (run under Node 20, `nvm use 20` in `cloudflare/email-worker/`):
    - `wrangler` → ^4.118.0, `postal-mime` → 2.7.5, `npm audit fix`, run `npm test`.
2. **Functions in-range updates** (`npm update`, all within existing semver ranges):
    - `ws` 8.21.2, `lodash` 4.18.1, `handlebars` 4.7.9 (critical fix), `cors` 2.8.6,
      `moment-timezone` 0.6.3, `@google-cloud/storage` 7.21, `@modelcontextprotocol/sdk` 1.30,
      `dotenv`, `figlet`, `mammoth`, `@dqbd/tiktoken`, `algoliasearch` 4.27, `openai` 6.49.
    - Then `npm audit fix` (never `--force`) for transitive-only fixes
      (`fast-xml-parser`, `basic-ftp`, `express`, `@xmldom/xmldom`, `tmp`, `glob`, …).
    - Run the functions test suite (root jest under Node 14: `npm test -- --testPathPattern="functions/"`).

## Phase 1 — functions targeted majors (one MR each, in order)

1. **Drop the runtime `firebase-tools` dependency** — highest value per effort. Only
   `require`d in `functions/FirestoreTool/Users.js` and
   `functions/Projects/onDeleteProjectFunctions.js` for recursive Firestore deletes;
   `firebase-admin` ≥10 has `firestore().recursiveDelete()` built in. Removing it kills the
   `request`/`tar`/`form-data` criticals and a huge install tree.
   _Note: this is separate from the CLI pin — keep deploying with the repo-pinned
   `firebase-tools@13.29.3` (newer CLIs reject the pre-existing 3600s scheduled-function
   timeouts in `index.js`)._
2. **Remove or align the direct `@google-cloud/firestore@^4.2.0`** — firebase-admin 12
   bundles its own Firestore client; the direct 4.x dep is stale and keeps the `protobufjs`
   critical alive. Check for direct imports; most likely it can be deleted.
3. **`twilio` 3 → 6** — fixes `axios` + `jsonwebtoken` highs. Review WhatsApp send paths.
4. **`firebase-admin` 12 → 14 and `firebase-functions` 5 → 7** — already on Node 22 + v2
   syntax, mostly mechanical. Own MR; verify a staging deploy actually updates every function
   (source-hash skip gotcha in CLAUDE.md).
5. **Payments, separately and carefully**: `stripe` 14 → 22 (pinned API version semantics —
   retest webhooks) and `@mollie/api-client` 3 → 4.
6. Lower priority: `googleapis` 174, `@deepgram/sdk` 5, `@tavily/core` 0.7 (API changed),
   `fs-extra` 11, `uuid` (check CJS support before going past v11). Longer-term:
   `sib-api-v3-sdk` is deprecated → `@getbrevo/brevo`.

**Do NOT update in functions**: `e2b` stays on `^1.x` (v2 is ESM-only, breaks the CJS
functions runtime — see CLAUDE.md); `zod` stays on 3.x until `@modelcontextprotocol/sdk`
supports zod 4.

## Phase 2 — root app hygiene (limited, deliberate)

All root installs MUST run under the pinned Node 14.21.3 / npm 6.14.18 — the lockfile is v1
and a modern npm would rewrite it to v3. Re-apply the `replacement_node_modules` Quill/y-quill
patches after any install.

-   **Remove dead/duplicate deps** (verify usage first): both
    `@react-native-community/async-storage` and `@react-native-async-storage/async-storage`
    are present; frontend `firebase-admin`/`firebase-functions` look vestigial (Jest maps
    those imports to `functions/node_modules`); the npm `http2` package is a deprecated no-op.
-   **In-range bumps npm 6 will accept**: `react-native-calendars`, `tinycolor2` 1.6,
    `chartjs-*` patches, `y-websocket` 1.5.4, `moment` 2.30.1, `husky` 4.3.8,
    `webpack-bundle-analyzer`, `css-loader` 5.2.7.
-   **Leave alone without a dedicated project**: the Quill/Yjs family (`quill` 1.3.7,
    `y-quill` 0.1.4, `yjs` 13.4.7 — patched and version-synced with functions; even the
    semver-minor yjs 13.6 bump interacts with the applyDelta workarounds),
    `react-tiny-popover` (dismiss-race workarounds are built against v4 behavior), and
    everything React/Expo/RN-versioned.

## Phase 3 — strategic frontend migration

Detailed plan: **`FRONTEND_MIGRATION_PLAN.md`**. Key insight: `app.json` declares
`platforms: ["web"]` — the product is web-only, so the migration is "modernize as a web
app" (new bundler on Node 22 → delete vestigial native deps → React 18 + RNW 0.21 →
Firebase 12 → Quill 2/Yjs stack), NOT a 21-SDK Expo upgrade treadmill. Rough total:
3–5 months, staged, each stage independently deployable.

## Status log

-   2026-08-04: Plan created. Phase 0 executed:
    -   Email worker: `wrangler` 4.75.0 → 4.118.0, `postal-mime` 2.7.4 → 2.7.5, tests pass.
        6 → 3 vulns; the remaining 3 are `undici` inside `miniflare` (dev-only tooling —
        npm's proposed "fix" is a wrangler _downgrade_ to 4.35, rejected).
    -   Functions: `npm update` + `npm audit fix` (no `--force`). 66 → 27 vulns
        (criticals 8 → 4, highs 29 → 12). All 4 remaining criticals are killed by
        Phase 1 items 1–2 (runtime `firebase-tools`, stale `@google-cloud/firestore`).
        `e2b` 1.x and `zod` 3.x pins held. Functions tests: 159/160 suites pass; the one
        failing suite (`calendarProjectRoutingConfig.test.js`, 2 tests) is pre-existing on
        master (model default changed to `MODEL_GPT5_6_LUNA` in `ff45a4d08`, unrelated to
        deps — flagged as a separate task).
    -   Phase 3 migration plan drafted → `FRONTEND_MIGRATION_PLAN.md`.
