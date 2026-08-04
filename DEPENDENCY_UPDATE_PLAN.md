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

1. **Drop the runtime `firebase-tools` dependency** — DONE 2026-08-04. The real surface was
   larger than first mapped: `recursiveDeleteHelper` in `Utils/HelperFunctionsCloud.js`
   wrapped `firebase_tools.firestore.delete` and was threaded through
   `Chats/onDeleteChatFunctions.js`, `Projects/onDeleteProjectFunctions.js`,
   `Projects/onUpdateProjectFunctions.js`, and `Users/onKickUserFromProject.js`
   (plus an unused import in `FirestoreTool/Users.js`). The helper now takes just a path and
   uses `admin.firestore().recursiveDelete()` (doc vs collection resolved by segment count);
   the `firebase_tools`/`process` parameter threading and the `GOOGLE_FIREBASE_DEPLOY_TOKEN`
   lookup are gone. Killed the `tar` critical and the firebase-tools install tree.
   _Note: this is separate from the CLI pin — keep deploying with the repo-pinned
   `firebase-tools@13.29.3` (newer CLIs reject the pre-existing 3600s scheduled-function
   timeouts in `index.js`). `npm run serve`/`deploy` inside `functions/` now resolve the
   global `firebase` CLI instead of a local one — consistent with the pin._
   1a. **Replace `html-pdf`** (discovered during 1): deprecated, PhantomJS-based, and the
   remaining source of the `request` + `form-data` criticals (npm's only "fix" is a
   downgrade to html-pdf 1.5). Single usage: `Payment/Invoices/Invoices.js` (invoice PDF
   generation). Migrate to e.g. `puppeteer-core` + `@sparticuz/chromium` or `pdfkit`,
   then delete the dep.
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

## Phase 2 — root app hygiene (limited, deliberate) — DONE 2026-08-04

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

-   2026-08-04 (Phase 2): root-app hygiene executed under the pinned Node 14 / npm 6
    (lockfile stayed v1; `replacement_node_modules` Quill/y-quill patches re-applied and
    diff-verified after installs).

    -   **Removed** (all verified unused): duplicate `@react-native-community/async-storage`
        (+ its stale manual mock), frontend `firebase-admin` + `firebase-functions` (only the
        jest moduleNameMapper references functions' own copies), npm `http2` shim.
    -   **Bumped in-range**: `react-native-calendars` 1.1314 (visual-check the calendar UI),
        `tinycolor2` 1.6, `chartjs-adapter-moment` 1.0.1, `chartjs-plugin-datalabels` 2.2.0,
        `husky` 4.3.8, `webpack-bundle-analyzer` 4.10.2, `css-loader` 5.2.7,
        `moment` pin 2.29.4 → 2.30.1.
    -   **`y-websocket` bump REVERTED — do not retry before Phase 3 Stage 0**: 1.5.4 (and
        even a fresh install of 1.3.17) nests a modern `lib0` whose optional chaining the
        Expo 36 webpack 4 / acorn parser cannot handle — `build_web_production` fails with
        `Module parse failed` in `y-websocket/node_modules/lib0` while jest stays green
        (Babel transforms what webpack does not). Now pinned exact `1.3.17` with the nested
        `lib0@0.2.42` block restored into the v1 lockfile from the last-good tree. Any
        package whose transitive deps re-resolve can hit this class of failure: **verify
        root-app bumps with a local `npm run build-web`, not just jest.**
    -   **Test layout**: root `npm test` (Node 14) now excludes `functions/` (aligning local
        runs with CI's web job) and three web-located bridge suites that require functions
        code — those moved into `ci/jest.functions.config.js` (`BRIDGE_SUITES`) and pass
        under Node 22. This also un-breaks CI's `test:web:changed` for branches that touch
        files related to those suites.
    -   **Deploy note**: the Phase 1 functions changes were NOT deployed by the green
        pipeline after the babel-range fix — `deploy:cloud:functions:production` only runs
        on `functions/**` diffs, and the fix commit had none (documented in
        `functions/index.js` header). The Phase 2 commit includes a `functions/**` change,
        so its pipeline runs the functions + Cloud Run deploys carrying all of Phase 1.

-   2026-08-04 (Phase 1 remainder, one combined change): items 1a–6 all executed.

    -   **firebase-admin 12 → 14 + firebase-functions 5 → 7 + @google-cloud/firestore 4 → 8**
        (interlocked: admin 14 makes the Firestore client a peer dep at ^8.6). Kills the
        `protobufjs` critical. admin 14 removed the legacy namespace statics — a codemod
        rewrote 366 `admin.firestore.{FieldValue,Timestamp,FieldPath}` usages across ~80
        files to modular `require('firebase-admin/firestore')` imports. Unused
        `firebase-functions-test` devDep dropped.
    -   **Functions tests moved to Node 22** via `ci/jest.functions.config.js` (skips Babel
        for functions/node_modules; `node:crypto` shim in `ci/nodeShims/`). The web-pinned
        Babel 7.12 cannot parse the new SDKs' syntax, and a global @babel/core bump breaks
        the Expo presets (verified A/B) — so web tooling stays untouched. CLAUDE.md updated.
    -   **html-pdf → puppeteer-core + @sparticuz/chromium** (invoice PDFs; kills the
        `request`/`form-data` criticals). `sendMonthlyInvoice*` memory 256MB → 1GiB for
        Chromium. Verify the first staging/production invoice renders correctly.
    -   **twilio 3 → 6** (surface used — `messages.create`, `validateRequest`,
        `twiml.VoiceResponse` — unchanged; load-smoke-tested).
    -   **@mollie/api-client 3 → 4**: snake_case binder aliases removed upstream;
        `customers_mandates`/`customers_subscriptions` renamed to
        `customerMandates`/`customerSubscriptions` in `Payment/Mollie.js`.
    -   **stripe 14 → 22**: runtime surface unchanged, BUT the newer pinned API version
        moves `current_period_end` from Subscription to SubscriptionItem — all read sites
        now fall back to `items.data[0].current_period_end`. Webhook event shapes are pinned
        account-side and unaffected. Retest checkout + premium status on staging.
    -   **@deepgram/sdk 4 → 5**: `createClient` → `new DeepgramClient({apiKey})`,
        `listen.prerecorded.transcribeFile` → `listen.v1.media.transcribeFile` (throws
        instead of `{result, error}`); options and response shape unchanged.
    -   **@tavily/core 0.0.2 → 0.7, googleapis 174, uuid 11** (surfaces verified);
        **fs-extra removed** (unused).
    -   **Audit after all of Phase 1: 0 critical, 0 high, 7 moderate** (was 66 total /
        8 critical at baseline).
    -   **Deploy checks for the next staging deploy**: (1) the pinned `firebase-tools@13.29.3`
        must discover the firebase-functions 7 manifest — `index.js` loads cleanly under v7
        locally, but confirm every function actually redeploys (source-hash + CreateFunction
        error check per CLAUDE.md); if discovery fails, fall back to `firebase-functions@^6`
        (the security fixes are not in that package). (2) First invoice PDF (Chromium render),
        (3) a WhatsApp send (twilio 6), (4) a Mollie subscription update (v4 binders),
        (5) premium status check (stripe 22 period-end fallback), (6) a meeting
        transcription (deepgram v5).

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
-   2026-08-04 (later): Phase 1.1 executed — runtime `firebase-tools` removed from
    `functions/` (see item 1 above for the full call-site inventory). Vulns 27 → 23;
    remaining criticals: `protobufjs` (→ item 2) and `request`/`form-data` via the
    deprecated `html-pdf` (→ new item 1a). Functions tests: 160/161 suites pass, only the
    pre-existing `calendarProjectRoutingConfig` failure remains.
