# Frontend Migration Plan (Phase 3 of the Dependency Update Plan)

_Drafted 2026-08-04. Companion to `DEPENDENCY_UPDATE_PLAN.md`._

## The key finding that shapes this plan

`app.json` declares `"platforms": ["web"]`. There are no `ios/` or `android/` directories in
the repo, and Expo's classic build service (`expo build:*`) was shut down in 2023 — **the
product is web-only today and has been for years**. The app is ~3,000 JS files (~2,000 in
`components/`) of react-native-web dialect, built through `expo build:web` on a frozen
Expo 36 / React 16.9 / Node 14 toolchain.

Consequences:

-   Chasing 21 Expo SDK upgrades (36 → 57) would modernize a _native_ pipeline nobody ships.
    Most of that pain (unimodules → Expo Modules, reanimated 1 → 4, screens, RN 0.61 → 0.86
    native breaking changes) buys nothing for a web-only product.
-   The realistic migration is: **treat it as a web app**. Keep the react-native-web
    component dialect (no rewrite of 2,000 components), replace the dead Expo build chain
    with a modern bundler, then raise React/RNW/Firebase versions in stages.
-   Native iOS/Android, if ever wanted again, is a _separate future project_ (fresh Expo/EAS
    app reusing components) — explicitly out of scope here.

Measured surface areas (import-site counts, so migration cost is proportional):

| Concern                        | Files touching it                                                 |
| ------------------------------ | ----------------------------------------------------------------- |
| `react-navigation` (v4)        | 1 (`AppNavigator.js`) — routing is really the custom `URLSystem/` |
| `react-native-reanimated`      | 0 direct imports (transitive only)                                |
| `react-native-gesture-handler` | 69 (mostly Touchables — web shims exist)                          |
| `react-beautiful-dnd`          | 17                                                                |
| Quill / react-quill (editor)   | ~40                                                               |
| Firebase client SDK v8 API     | 25                                                                |
| `Platform.OS` branches         | 21                                                                |
| `expo-*` module imports        | 8                                                                 |

## Stages

Each stage lands independently on `develop`, deploys to staging, and is verified for parity
before the next begins. No big-bang branch.

### Stage 0 — New build pipeline, zero app-code changes (~1–2 weeks)

Goal: build the _current_ code (React 16, RNW 0.11) with a modern bundler on Node 22,
killing the Node 14 / npm 6 / expo-cli 6 pin for the web build.

-   Replace `expo build:web` + `@expo/webpack-config` with a standalone webpack 5 (or Vite +
    `vite-plugin-react-native-web`) config: alias `react-native` → `react-native-web`, keep
    the Babel class-properties/JSX config the Metro preset provided, port the PWA bits
    (`web/` static assets, `service-worker.js`, `firebase-messaging-sw.js`, manifest).
-   Port `ci/replace-envs.sh` env injection and the `replacement_node_modules` Quill/y-quill
    post-install swap into the new pipeline unchanged.
-   Acceptance: staging deploy from the new pipeline is pixel/behavior-identical; old
    pipeline kept in CI until then. Bundle-size diff reviewed (`webpack-bundle-analyzer`).
-   This stage alone unblocks installing the repo on modern machines/CI images.

### Stage 1 — Dependency floor: delete the vestigial native/dead deps (~2–4 weeks)

No framework version changes yet — just removing what web never uses, which collapses most
of the 253 audit findings:

-   Remove: `@react-native-firebase/*` (5 pkgs), `react-native-reanimated`,
    `react-native-screens`, `react-native-unimodules`, `unimodules-permissions-interface`,
    `expo-updates`, `expo-application`, `expo-device`, duplicate
    `@react-native-community/async-storage` (keep `@react-native-async-storage/…`),
    frontend `firebase-admin` + `firebase-functions` (Jest maps those imports to
    `functions/node_modules` already), npm `http2` shim, `@sentry/tracing`+`sentry-expo`
    (→ `@sentry/react` for web).
-   Replace the 8 `expo-*` import sites with web equivalents: `expo-localization` →
    `navigator.language`, `expo-image-picker`/`expo-image-manipulator` → file input +
    canvas, `expo-font` → CSS `@font-face`, `expo-constants`/`expo-linking` → small local
    shims. `react-native-gesture-handler` stays for now (its web shim backs 69 files).
-   Acceptance: app builds and passes the QA smoke checklist; audit count for the root app
    drops sharply; bundle shrinks.

### Stage 2 — React 16 → 18 and react-native-web 0.11 → 0.19/0.21 (~3–6 weeks)

The riskiest framework jump, done as one stage because RNW 0.19+ requires React 18:

-   `ReactDOM.render` → `createRoot`; audit legacy-context/`UNSAFE_` lifecycles (old RN-era
    components likely have some); keep StrictMode **off** initially.
-   `react-redux` 7 → 8 (React 18 requirement), `redux` 4 stays.
-   `react-beautiful-dnd` is unmaintained and StrictMode-hostile → swap the 17 files to the
    API-compatible fork `@hello-pangea/dnd`.
-   RNW 0.11 → 0.21 breaking changes: removed/renamed props, `accessibilityLabel`→`aria-*`
    mappings, style behavior deltas. Do a codemod pass, then visual QA per feature area.
    `Dimensions.get('window')` usage (per CLAUDE.md convention) keeps working.
-   `react-navigation` v4: only `AppNavigator.js` imports it; fold the top-level stack into
    the existing `URLSystem/` (plain history-driven view switching) and delete
    `react-navigation*` + its gesture/reanimated transitive needs entirely.
-   Acceptance: full QA pass, snapshot suite re-baselined, Sentry error rate on staging flat.

### Stage 3 — Firebase JS SDK 8 → 12 (~2–3 weeks)

-   Step 1: `firebase@8` → `firebase@12` using **`firebase/compat`** imports only — the v8
    API surface keeps working, isolated in `utils/backends/` + 25 import sites.
-   Step 2: convert file-by-file from compat to the modular API behind the existing
    `BackendBridge` facade (tree-shaking win lands here).
-   Fixes the client-side `@firebase/firestore` highs and the auth/persistence CVEs.
-   Acceptance: auth flows, Firestore listeners, RTDB presence, FCM web push
    (`firebase-messaging-sw.js` must be migrated in the same MR) verified on staging.

### Stage 4 — Editor/collab stack: Quill 2 + Yjs (~4–8 weeks, highest risk)

Isolated last because it touches production collaborative documents:

-   `quill` 1.3.7 → 2.x, `react-quill` (dead beta) → `quill` used directly or the
    `react-quill-new` fork, `quill-cursors` 5, `y-quill` 0.1.4 (patched) → 1.0,
    `yjs` 13.4.7 → 13.6.x — **root and `functions/` must move `yjs` in lockstep**
    (both pin 13.4.7 today; `functions/Assistant/markdownToYjs.js` shares doc semantics).
-   Re-derive or retire the two custom patches in `replacement_node_modules/`: verify
    whether y-quill 1.0 fixes the `applyDelta()` null-attribute format-removal bug
    ([yjs#474](https://github.com/yjs/yjs/issues/474)) upstream; if not, re-apply the
    `doc.transact()`-wrapped `type.format()` fix against the new code. Re-validate every
    documented Yjs gotcha in CLAUDE.md (attribute bleed, background "None" handling).
-   The auxiliary quill plugins (`quill-paste-smart`, `quill-image-drop-module`,
    `quill-drag-and-drop-module`, `quill-delta-to-html`) need Quill-2-compatible versions
    or replacement; `quill-delta-to-html` is also the path that pulls vulnerable
    `dompurify` — pin a patched dompurify explicitly.
-   Acceptance: round-trip tests against **copies of real production Yjs docs** (old docs
    must load, edit, persist, reload byte-stable); multi-client concurrent editing session
    test; markdown-to-Yjs assistant path re-tested.

### Stage 5 — Toolchain finish line (~1–2 weeks)

-   Jest 25 → 30 (drop the react-native preset for a jsdom/web preset, re-baseline
    snapshots), `@testing-library/react` for new tests, Prettier 2 → 3 + repo-wide format
    commit, TypeScript 3.9 → 5.x (types-only today), husky 4 → 9, Node 22 declared in
    `.nvmrc`/CI everywhere, `package-lock.json` to lockfile v3. Update CLAUDE.md's
    "Required versions" section.

### Stage 6 — Optional / later

-   React 18 → 19 (small once 18 is stable), `redux` 5 / RTK, `moment` → `dayjs`, and the
    **native apps decision**: if iOS/Android return to the roadmap, start a fresh Expo
    SDK-current project that imports the (by then modern) shared components — do not
    resurrect the Expo 36 native pipeline.

## Sequencing, effort, risk

-   Order is fixed: 0 → 1 → 2 → 3 → 4 → 5 (each unlocks the next; 3 and 4 could swap).
-   Rough total: **3–5 calendar months** single-engineer; stages 1–3 parallelize poorly
    (shared surface), stage 4 is independent enough to overlap with 5.
-   Biggest risks, in order: (1) Yjs/Quill data compatibility (stage 4 — mitigate with
    prod-copy round-trip tests), (2) RNW 0.11 → 0.21 visual regressions across ~2,000
    components (mitigate with per-feature QA passes + Percy-style screenshot diffing on the
    main views), (3) service-worker/FCM breakage in stages 0/3 (mitigate: test web push on
    staging explicitly).
-   Throughout: the old build pipeline stays green in CI until stage 0 parity is confirmed;
    every stage is revertable by itself.

## What this plan deliberately does NOT do

-   No Expo SDK upgrade treadmill (36→57) — the native targets it serves are not shipped.
-   No component-dialect rewrite (RN-web JSX stays; React Strict DOM or plain React is a
    future option, not a migration requirement).
-   No touching of `functions/` beyond the lockstep `yjs` bump in stage 4 (functions
    updates are Phases 0–1 of `DEPENDENCY_UPDATE_PLAN.md`).
