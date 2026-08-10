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
-   Step 2 (compat → modular): **measured 2026-08-06 and DEFERRED — do not start this
    without re-reading the numbers below.** The tree-shaking win is real but small, and
    the cost is not.
    -   **Prize, measured rather than assumed**: the exact SDK surface this app uses
        (app, auth, firestore, functions, storage, messaging, database), built both ways
        and minified+gzipped, is **266.2 KB compat vs 209.7 KB modular — 56.5 KB saved,
        2.5% of the 2.25 MB app JS bundle**.
    -   **Cost**: ~3,200 chained call sites — 553 `.collection(`, 708 `.doc(`,
        452 `.where(`, 538 `.get()`, 422 `.update(`, 245 `FieldValue.`, 135 `.onSnapshot(`
        — over 25 files concentrated in `utils/backends/`, with the 7,778-line
        `firestore.js` dominating. Every one is a live data path.
    -   **"File-by-file" is misleading**: tree-shaking only drops compat when the LAST
        compat import goes, so a partial conversion ships BOTH APIs and is temporarily
        _larger_. The 56 KB lands at 100% or not at all — incremental risk, no incremental
        benefit.
    -   Compat is fully supported and not deprecated, so staying on it is a legitimate end
        state rather than debt. The security objective that motivated Stage 3 was met in
        full by step 1.
    -   **If it is ever revisited, the blocking landmine is `getFirestore(app)`**: it does
        NOT return the compat instance's client. Verified in both orderings — always two
        distinct `Firestore` instances on the same app and same `(default)` database, so a
        converted file using it would give the app two clients (two caches, two connection
        streams, writes on one invisible to the other's listeners without a server round
        trip). The only safe modular handle during a migration is the compat instance's
        `_delegate`, confirmed working with `doc()`, `collection()`, `query()`, `where()`.
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

## Status log

-   2026-08-10 — **STAGE 4 ACCEPTED AND MERGED TO MASTER** after the user's staging QA.
    Three staging findings, all quill 1→2 rendering-contract changes and each now pinned
    by a regression test: (1) the header picker rendered raw label text — quill 2 stamps
    `data-label` onto the picker label and drops empty `data-value` attributes, both of
    which the vendored CSS keys off (`quill2SetupPicker.test.js`); (2) "- " bullet lists
    displayed as numbered — quill 2 renders every list as `<ol>` with `li[data-list]` +
    a `.ql-ui` marker element, so the v1 list CSS was ported wholesale in
    `toolbar-styles.css`; (3) clicking above a pasted markdown table couldn't place the
    caret — the table blot was an inline Embed (span) whose quill-2 cursor guards sat
    inside its contenteditable=false node; it is now a BlockEmbed (div), verified
    against a real quill 2 instance incl. legacy trailing-newline docs
    (`markdownTableFormat.test.js`).

-   2026-08-10 — **Stage 4 core landed on `frontend-migration-stage-4`** (quill 1.3.7 →
    2.0.3, react-quill 2.0.0-beta.2 → react-quill-new 3.8.3, quill-cursors 3.0.1 → 5.0.0,
    y-quill 0.1.4-patched → 1.0.0 stock, yjs 13.4.7 → 13.6.32 root + `functions/` in
    lockstep). Staging QA is the remaining exit gate.

    -   **All three collab patches in `replacement_node_modules` retired.** The quill dist
        patch (141 semantic lines, extracted by prettier-normalizing both bundles) became
        app code in `components/Feeds/CommentsTextInput/quill2Setup.js`: an `editorMeta`
        module replaces the patched constructor (placeholder-metadata decode, per-editor
        classes, `enablePasteListener`), a Clipboard subclass gates quill 2's new
        copy/cut/paste root captures (quill 1 never captured copy/cut — leaving cut
        ungated would double-delete, since the app's own `onCopy` cut path also deletes
        the selection), a History subclass restores the `beforeUndoRedo` hook, and a Snow
        theme subclass re-implements `data-html` toolbar/picker injection, the
        header-picker selected-icon label, the chevron, and removes quill's cmd+K link
        binding. Deliberately NOT re-derived: the link-tooltip preview for `url` embeds
        and its parchment `descendant({blotName:'url'})` support hunk (UrlWrapper's own
        interaction popup covers it; nothing else calls `descendant` with an object).
    -   **The y-quill patch (yjs#474 applyDelta-null workaround + insert-bleed
        prevention) is obsolete upstream** — verified empirically before adopting: yjs
        13.6.32 removes formatting via null attributes and no longer inherits attributes
        on applyDelta inserts. Both behaviors, plus background-"None", persist-then-reload
        bleed, remote-insert negation, and two-client convergence, are pinned by
        `yQuillBinding.test.js` (runs the real y-quill 1.0 binding against a minimal
        quill stand-in). `y-webrtc` and `y-indexeddb` were deleted outright — notes
        collab has used y-websocket for years; the WebRTC path (and the patch's
        room-guard removal + app-code import) was dead. `quill-paste-smart` and
        `quill-image-drop-module` were also removed (imports were already commented
        out), which takes `dompurify` out of the tree entirely.
    -   **13.4.7-document compatibility is pinned by fixtures**: real
        `encodeStateAsUpdate` blobs generated with yjs 13.4.7 (rich text, all nine custom
        embeds, format boundaries — two of them carrying 13.4's authentic
        inheritance-bug artifacts, like production docs do) are embedded in
        `__tests__/Yjs/yjs1347Compat.test.js` and must decode to the exact 13.4.7 delta,
        survive edit → persist → reload delta-identically and byte-stably, and keep
        honoring `TemplatesHelper`'s mutate-`toDelta()`-embeds-by-reference contract.
        Cross-version merge (13.6-written update into a live 13.4 client) was verified in
        the migration scratchpad — wire format v1 is unchanged.
    -   **Quill 2 API port** across the ~30 editor files: all 11 custom embed blots to
        the parchment-3 `constructor(scroll, domNode)` signature; keyboard bindings from
        keyCodes to key strings (`bindings[9]`/`[13]` → `'Tab'`/`'Enter'` — v2 keys the
        map by `event.key`, so the numeric idiom silently no-ops); `clipboard.convert( string)` → `convert({ html })` (4 sites); `Attributor.Style` →
        `StyleAttributor` (kept style-based on purpose — an attribute attributor would
        wake the dormant autoformat-helper flow); `options.formats` null guard;
        `getBounds` null guards; `UrlInline` deleted (dead code whose `allowedChildren`
        held a React Native component). `react-quill-new` is a props-compatible drop-in
        (verified: same `value`/`onChange`/`getEditor`/`ReactQuill.Quill` surface, and
        its `setEditorContents` already uses the v2 convert form); its runtime has no
        named `Quill` export, so registry-only files import `quill` directly. Root pin
        is exact `quill@2.0.3` so react-quill-new's `~2.0.3` dedupes to ONE registry.
    -   **Jest**: the root suite transforms all of node_modules (the long-standing
        malformed `transformIgnorePatterns` regex), which is what lets jest 25 on Node 14
        digest the ESM-only quill 2 / react-quill-new / parchment 3 / lib0 chain; the one
        real gap was `global.crypto` for lib0's webcrypto module (Node 14 has none) —
        polyfilled in `ci/jestSetup.js` with a `randomFillSync`-backed shim. Functions
        suite (Node 22): 1661/1663 green with yjs 13.6.32 — the 2 failures are a
        pre-existing master issue in `calendarProjectRoutingConfig.test.js` (stale
        GPT-model default assertions, spun off as its own task).
    -   **Verification state (2026-08-10, commit 054e63a55)**: full root jest green
        (347/347 suites, 1533 tests, 165 snapshots, under the `npm test` TZ=UTC pin);
        web-bundler prod build compiles with only the 3 known RNGH warnings; branch CI
        pipeline 2746125836 green end to end (branch-scoped images rebuilt, `build_web_webpack_check` pass, `test:web:changed` honest selection: 29 files → 222
        suites / 958 tests pass); `deploy:web-staging-live` succeeded — the Stage 4
        artifact is live on `alldonestaging.web.app`.
    -   **Remaining for stage acceptance — the user's logged-in QA on staging** (a
        browser boot check first: zero console errors on load, per the Stage 0/3
        lesson): two browsers on one note (concurrent typing, cursors), format removal +
        background "None" + reload (no bleed), paste (markdown/html/plain) in notes vs
        chat inputs, mentions modal Enter/Tab handling, drag-drop file onto note,
        undo/redo incl. hashtag colors, header picker + mobile popups rendering
        (`data-html` items), markdown tables, copy/cut out of editors (quill 2 newly
        captures these — the gated clipboard must leave the app's handlers in charge),
        and old real production notes opening correctly before/after an edit session.

-   2026-08-05 — **Stage 3 step 1 executed and ACCEPTED ON STAGING: firebase 8.10.1 →
    12.17.1 via `firebase/compat`** (step 2 — file-by-file modular conversion behind
    BackendBridge — deliberately waits, per the stage discipline). Branch
    `frontend-migration-stage-3`, deployed to `alldonestaging.web.app` via the new manual
    `deploy:web-staging-live` job and confirmed working by the user.

    -   **A preview channel is NOT sufficient for this stage's QA.** Google Identity
        Services enforces an authorized-JavaScript-origin allowlist on the OAuth client,
        that list lives in Google Cloud Console, and a generated preview origin is not on
        it — so Google sign-in cannot be exercised there. Since `deploy:web-dev` (staging
        live) is gated on the long-stale `develop`, a feature branch had no route to a
        registered origin at all; `deploy:web-staging-live` is that route, manual and with
        the project named explicitly so a mis-click cannot reach production.
    -   **Boot verified on the deployed artifact** (the Stage 0 lesson — a clean compile
        proves little): zero console errors, `Deferred Firebase modules loaded`,
        `onAuthStateChanged` + `getRedirectResult` firing, GSI accepting the origin, and
        the service worker serving the 12.17.1 compat builds with no unsubstituted
        `__FIREBASE_*` placeholders.
    -   **One v12 behavior change caught by that boot check**: Firestore logged
        `You are overriding the original host` on every load, because firebase 9+ makes
        `settings()` replace the whole settings object; the call now passes
        `merge: true` (verified against the compat source, which is where that warning
        and its recommendation come from).

    -   **Install**: `firebase@12.17.1` (exact pin) under the pinned Node 14 / npm 6;
        lockfile stayed v1; `replacement_node_modules` patches re-applied and diff-verified.
        npm audit: **zero firebase-related findings remain** (was the v8 client SDK +
        `@firebase/firestore` highs and auth/persistence CVEs).
    -   **Import rewrite (23 files, mechanical)**: every client import used the same v8-era
        deep import `import { firebase } from '@firebase/app'` → now
        `import firebase from 'firebase/compat/app'` (that named export no longer exists in
        v12, so the deep import had to die anyway). The 7 lazy service loads in
        `utils/backends/firestore.js` (`require('firebase/auth')` etc., incl. the deferred
        functions/storage/messaging/database block) → `firebase/compat/*`. Compat keeps the
        v8 lazy-attachment semantics (services appear on the namespace when their compat
        module loads), so the deferred-load boot flow is unchanged.
    -   **Only real API break: `messaging.onTokenRefresh()`** — removed in v9+, absent even
        from compat. The three listener blocks in `firestore.js` were deleted; token
        freshness is already covered by the `getToken()`-on-every-load calls that remain.
        Everything else the app uses (namespace Firestore/auth/functions/storage,
        `FieldValue`/`Timestamp` statics, `signInWithPopup`, `GoogleAuthProvider.credential`,
        `setPersistence`, `db.settings`, `useEmulator`, `messaging.isSupported`) is
        compat-supported unchanged.
    -   **FCM service worker** (`web/firebase-messaging-sw.js`): CDN importScripts bumped to
        `12.17.1/firebase-{app,messaging}-compat.js`; `setBackgroundMessageHandler` (also
        removed) → `onBackgroundMessage`. Placeholder env injection in `ci/replace-envs.sh`
        untouched. The app never registers the SW explicitly — the SDK still auto-registers
        `/firebase-messaging-sw.js` at `getToken()` time in v12 compat.
    -   **Jest fallout — the root `firebase` package is exports-only in v12** (no `main`),
        which jest 25's resolver cannot see. 47 test files carried an identical vestigial
        `jest.mock('firebase', () => ({ firestore: {} }))` (nothing imports the root
        package — before or after); those lines started throwing "Cannot find module
        'firebase'" at mock-resolution time and were deleted (behavior-identical).
        `firebase/compat/app` itself resolves fine everywhere: it ships a physical
        directory with a `main`-carrying package.json stub, loads under plain Node 14, and
        sets `__esModule` so babel default-import interop is correct. Two co-located suites
        that mocked `@firebase/app` now mock `firebase/compat/app` (default-export shape).
    -   **Verified**: web-bundler prod build compiles clean on Node 22 (only the 3 known
        RNGH DrawerLayoutAndroid warnings; webpack parses firebase's ES2017 dist directly —
        babel never touches it — and the nearest-first `resolve.modules` note from Stage 0
        already covers @firebase's nested tslib). Full root jest suite: green except two
        failures **proven pre-existing on master** (both from same-day master commits, not
        Firebase): `URLsContacts` push history (db53675e4, spun off as its own task) and a
        stale `SocialText` snapshot that 378e4cf6f forgot to re-baseline (updated here —
        the onClick-less render is that commit's intended behavior).
    -   **CI could not build the branch at all until the image strategy was fixed**
        (second commit on the branch). `build_base` / `build_web_bundler` bake
        `node_modules` and were rebuilt only on develop/master, while branch jobs just
        `ln -s /app/node_modules` and never install — so the branch built against the
        _previous_ lockfile and every new import failed to resolve (`Can't resolve 'firebase/compat/app'` from webpack, `Cannot find module …` from jest, both green
        locally). Rebuilding `:latest` from a branch is unsafe because master builds from
        that tag, so a dependency-changing branch now builds its own images under
        `:$CI_COMMIT_REF_SLUG` and the two consuming jobs select it via a rules-level
        `APP_IMAGE_TAG` (default `latest`). The trigger path list is the union of what
        both images bake, shared by both cache jobs, so the base image the bundler image
        is built FROM always exists; the new rule goes first in the consuming jobs since
        first match wins. Leaves one image per such branch in the registry — a tag
        cleanup policy is the way to bound that. **Stage 4 (quill/yjs) and Stage 5
        (jest/prettier/TypeScript) would each have hit this same wall.**
    -   **Note for the tslib-shaped trap**: firebase 12 keeps root `tslib` at 1.11.1 and
        nests `tslib` 2.8.1 inside 29 of its 44 `@firebase/*` packages. Any future
        "just copy the new packages into node_modules" shortcut risks hoisting 2.8.1 to
        the root — the mirror image of the Stage 0 resolution bug. Install through the
        lockfile, never by copying.
    -   **CI verified on branch `frontend-migration-stage-3`** once the image fix landed:
        `modules_cache` + `web_bundler_cache` build the branch-scoped images (6.5 min cold,
        1.2 min once kaniko's cache is warm), `build_web_webpack_check` **passes** with
        firebase 12, and `test:web:changed` is 962/963 — the only failure is the
        pre-existing `URLsContacts` push-history one that reproduces on clean master.
        `deploy:web-webpack-preview` is then playable for the staging QA below. Note the
        branch rebuilds its images on **every** push, because `changes: compare_to` diffs
        against master and the lockfile always differs there; the warm cache keeps that
        cheap. One unrelated latent bug was fixed to get there:
        `ChangeTextFieldModal.componentDidMount` guarded `this.inputText` (the ref object,
        always truthy) rather than `.current`, and threw whenever the modal unmounted
        before its 1 ms focus timer fired — invisible locally, lost the race under CI's
        loaded `--runInBand` run.
    -   **STAGE 3 COMPLETE — accepted on staging, merged, live in production, and web push
        confirmed working there (2026-08-06).** Push was the last item no automated or
        anonymous check could reach, and the riskiest: the service worker changed on two
        axes at once (12.17.1 compat CDN builds, and `setBackgroundMessageHandler` →
        `onBackgroundMessage`), and a regression would have been silent — no error, no
        Sentry event, just notifications quietly not arriving. Note the SW rename was
        **mandatory, not cosmetic**: the old method no longer exists in 12.17.1 (the only
        occurrence left in the CDN bundle is an error-message string), so leaving it would
        have broken background push on the first deploy.
    -   Step 2 (compat → modular) is measured and deferred — see the Stage 3 section above
        before reopening it.

-   2026-08-05 — **Stage 2 QA round 2 complete: gestures, navigation scroll, and the
    popover-positioning saga all fixed** (user-verified on staging).

    -   RNGH web patches v2/v3: event dispatchers threaded through
        `attachGestureHandler` (DOM refs have no `.props`; swipe crashed on
        delivery), and `createNativeWrapper` skips its prototype-chain method walk
        for DOM refs (reading DOM accessor properties with the prototype as
        receiver throws "Illegal invocation"; React 18's recovery then broke first
        paint of anything containing RNGH buttons).
    -   Navigation scroll reset: screens flow in the body now (old stack rendered
        per-screen cards), so `AppNavigator` scrolls to top on route change.
    -   **Popover positioning (three stacked root causes, found via write-level
        instrumentation + a user-run DOM probe):** (1) React 18's batched commits
        made `renderWithPosition` skip its completion callback when position info
        was unchanged — the opacity flip lives in that callback (popover stayed
        invisible); (2) all `contentLocation` helpers added window-scroll offsets
        to viewport math and rendered `absolute` — correct only when the window is
        the scroller, which the RNW 0.21 layout broke (invisible until scroll,
        wobble while scrolling). Now: helpers return pure viewport coordinates and
        the patched popover positions `fixed` for any active contentLocation,
        `absolute` for anchored mode; (3) the patched popover's ResizeObserver
        applied legacy document-coordinate math (+pageYOffset, bottom-edge clamp)
        on every content resize, silently yanking the fixed container to the lower
        viewport (user-measured styleTop 376 = 80 + scrollY 1560 clamped against
        the 798px viewport — arithmetic reproduced exactly). It now recomputes
        through the normal pipeline in contentLocation mode.
    -   `getScrollOffsets` also fixed (`??` → `||` so a 0 `pageYOffset` falls
        through to the body scroller) for any remaining document-coordinate users.
    -   All popover diagnostics stripped after confirmation; 930 tests across the
        touched suites pass.

-   2026-08-05 — **Stage 2 MERGED to master and verified in production.** Drag &
    drop (incl. drop-onto-task) and the general click-around passed the user's
    staging QA; the merge rebuilt the CI images with the React 18 tree (branch
    jobs blocking again per the TODO), the production deploy succeeded, and
    my.alldone.app serves the React 18 + RNW 0.21 build. Next: Stage 3
    (Firebase 8 → 12 via compat) under the same staging-slot discipline.

-   2026-08-05 — **Stage 0 ACCEPTED (second attempt): deploys flipped to the webpack
    pipeline after a logged-in QA pass on staging live.** The re-flip gate was met:
    the corrected artifact (scoped sloppy-CJS + require-cycle fix below) was
    boot-verified locally, deployed to staging live, and passed the user's logged-in
    QA on the exact task-view flow that broke production on the first attempt.
    `build_web_production` / `build_web_staging` now run the web-bundler build on the
    Node 22 tooling image (same env injection + GitHub mirror before_script as
    before), the expo build jobs are deleted, and `build_web_webpack_check` remains
    as the feature-branch build + preview feed. The expo toolchain (expo-cli, root
    webpack.config.js, `npm run build-web`) is local-legacy only and gets removed
    with the Stage 2 branch.

-   2026-08-04/05 — **First flip REVERTED after a production incident; two root causes
    fixed.** (1) The webpack pipeline produced strict ES modules while metro's preset
    had compiled sloppy-mode CJS with var hoisting for years — implicit-global writes
    (`versionUnsub`/`lastPushTime` in `utils/backends/firestore.js`) and a TDZ crash
    (`utils/backends/openTasks.js`) became runtime ReferenceErrors on logged-in flows.
    Fix: `@babel/plugin-transform-modules-commonjs` (strictMode:false, loose) +
    block-scoping→var, scoped to APP SOURCE ONLY. (2) Applying that transform to
    node_modules exposed a second landmine: the replacement_node_modules RNW
    TouchableOpacity patch imported app code from inside react-native-web, creating a
    node_modules→app→gesture-handler→react-native require cycle that only harmony-ESM
    builds tolerated (webpack hands out partially evaluated exports:
    strictModuleExceptionHandling is off). Fix: patch deleted; dismissible-touch
    capture is a document-level capture-phase listener in AppContent (superset
    semantics). Lessons encoded: logged-in staging QA is the flip gate; artifacts get
    a local debug-harness boot check before staging deploys; going strict-ESM later
    requires an ESLint `no-undef` + `no-use-before-define` sweep first.

-   2026-08-04 — **Stage 0 built and locally verified** (`web-bundler/`): standalone
    webpack 5 pipeline on Node 22 building the unchanged app source (React 16, RNW 0.11)
    against the root Node-14-installed `node_modules`.

    -   Same entry chain as expo (`expo/AppEntry.js`), same output contract
        (`web-build/`, `static/js/[name].[contenthash]`, `fonts/`, `static/media/`,
        `web/` statics, snapshotted PWA assets in `web-bundler/static/`). HTML template =
        `web/index.html` with expo's build-time injections pre-applied.
    -   webpack 4→5 gaps closed: node polyfills via `resolve.fallback` + ProvidePlugin
        (crypto/stream/buffer/process for the y-webrtc→simple-peer chain), `setimmediate`
        entry polyfill for RNW 0.11, `__DEV__`/`process.env.APP_MANIFEST` DefinePlugin
        (expo-constants is read by sentry-expo). Babel: preset-env/react(classic)/flow
        (`all`, RNW 0.11 dist still ships Flow) + preset-typescript for the 3 `.ts` api
        files; transform-runtime pinned to the tooling's own `@babel/runtime`.
    -   Verified: prod + dev modes compile with 0 errors and 5 warnings (all
        pre-existing BackendBridge dead re-exports). Bundle gzip 2.0 MB vs expo's
        2.5 MB. Fonts/media/moment-locales/quill-css presence diffed against the last
        expo build; all output URLs serve 200; **browser smoke test passes** — the
        build boots to a login page pixel-identical to the expo build's.
    -   **Two runtime defects found by the smoke test** (bundles compiled clean but the
        app didn't boot — always smoke-test in a browser, compile success proves little):
        1.  Four components used the RN-era sloppy idiom `export default Name = (...)`
            (assignment to an undeclared identifier). The old pipeline compiled modules
            to sloppy-mode CJS, silently creating globals; real ES modules are strict
            → `ReferenceError` during entry evaluation, which aborts the whole main
            chunk with **zero console errors** (the exception unwinds out of webpack's
            chunk startup). Fixed as `const Name = …; export default Name`
            (behavior-identical; CommentTagsSection, Footer, EmailWrapper,
            InheritedPropertiesHeader; related Jest suites pass).
        2.  `resolve.modules` listed the root node_modules as an absolute path first,
            which defeats nearest-first resolution: every `@firebase/*` package nests
            tslib 2.3.1 while the hoisted root tslib is 1.11.1 (no `__spreadArray`),
            so the deferred Firebase load threw `__spreadArray is not a function` at
            runtime (surfacing only as an unhandled rejection; the app hung on
            "Negotiating with the backend…"). Fix: default `modules: ['node_modules']`
            — this also dropped the build warnings from 49 to 5.
            Also set `scriptLoading: 'blocking'` so script placement matches the old
            pipeline exactly (body-end, no defer).
    -   CI: `web_bundler_cache` (Node 22 tooling image, `ci/Dockerfile_web_bundler`) +
        `build_web_webpack_check` shadow build (allow_failure) on all web-relevant
        changes. Expo pipeline stays the deployed artifact.
    -   **Remaining for stage acceptance**: deploy the shadow artifact to a staging
        channel, run the QA smoke checklist + web push, review bundle diff, then flip
        the deploy jobs' `needs` to the new build and delete the expo pipeline.

-   2026-08-04 — **Stage 1 executed** (vestigial-dep floor). All installs under the pinned
    Node 14 / npm 6; lockfile stayed v1; `replacement_node_modules` patches re-applied.

    -   **Removed 22 direct deps**: `@react-native-firebase/{app,auth,database,firestore,messaging}`,
        `react-native-reanimated`, `react-native-screens`, `react-native-unimodules`,
        `unimodules-permissions-interface`, `expo-updates`, `expo-application`,
        `expo-device`, `@sentry/tracing`, `sentry-expo` (→ `@sentry/react@7`, the last
        major supporting React 16.9), `react-navigation-drawer` (bonus — imported by
        nothing), and the five shimmed expo modules `expo-localization`,
        `expo-image-picker`, `expo-image-manipulator`, `expo-linking`, `expo-font`
        (+ vestigial direct entries `expo-constants`, `expo-modules-core`).
        `expo-font`/`expo-constants`/`expo-asset` remain in the tree as `expo`'s own
        deps — the `expo/AppEntry` boot chain still needs them until the expo pipeline
        dies. Dead `sentry-expo` postPublish hook dropped from `app.json`.
    -   **New `utils/WebShims/`** (Localization, Linking, ImagePicker, ImageManipulator,
        Fonts) replacing the 8 expo-\* import sites — each implements exactly the surface
        the app used, the same way expo's own web implementations did (file input +
        data URL, canvas resize, FontFace API, `navigator.language`). Jest mocks
        (global `ci/jestSetup.js` + 6 test files) now mock the shim paths.
    -   **react-native-screens removal**: its only importer, `react-navigation-stack`,
        requires it in a try/catch and guards every use behind `Platform.OS !== 'web'`
        — but webpack still hard-fails on the unresolved require, so BOTH webpack
        configs (root + web-bundler) got an `IgnorePlugin(/^react-native-screens$/)`,
        which turns the require into the runtime throw the library's catch was
        designed for. `react-native-gesture-handler` stays (69 files);
        `react-navigation`/`-stack` die in Stage 2.
    -   **Verified**: webpack pipeline builds clean (same 5 pre-existing warnings);
        full root Jest suite green (333 suites / 1481 tests / 165 snapshots); legacy
        expo pipeline rebuilt locally with expo-cli 6.1.0. Audit (same-day npm 6
        baseline vs after): 3003 → 2844 packages, findings 1517 → 1485 (−17 high,
        −2 critical). The count stays dominated by the retained Expo/webpack-4 build
        chain — the big collapse lands when the expo pipeline is deleted after
        Stage 0's staging acceptance, and with React/RNW in Stage 2. Bundle size is
        effectively unchanged (the removed packages were mostly never bundled).
    -   **Remaining for stage acceptance**: QA smoke checklist on staging (image
        upload/resize paths — avatar, company logo — plus meeting-link opening and
        language detection all now run on the shims).

-   2026-08-05 — **Stage 2 core landed on `frontend-migration-stage-2`** (React 18.3.1,
    react-native-web 0.21.2, react-redux 8.1.3, @hello-pangea/dnd 16.6, react-navigation
    deleted). Webpack build compiles clean with the prod-parity sloppy-CJS babel
    semantics. Key changes beyond version bumps:
    -   `utils/NavigationService.js` + `AppNavigator.js` rewritten as a ~50-line
        observable route store (the old code reset the stack on every navigate, so
        remount-per-navigate is the only semantic; 467 `navigation.*` call sites work
        unchanged through a compat prop). Dismissible-touch capture moved from the
        patched RNW TouchableOpacity to a document-level capture listener.
    -   `replacement_node_modules` dispositioned: RNW patches retired (obsolete or
        replaced), rbd patch ported to @hello-pangea/dnd (`combine.index`), new RNGH
        guard for RNW 0.21's removed DrawerLayoutAndroid. Full inventory in CLAUDE.md.
    -   Webpack entry replaced (`web-bundler/entry.js`): RNW 0.19+ AppRegistry mounts
        through createRoot; the expo 36 launch chain is dropped.
    -   **Jest now tests react-native-web** (what ships): RN preset replaced with
        explicit babel-jest + web-only haste platforms; `__mocks__/react-native.js`
        wraps react-native-web (RN 0.61's React-16 renderer cannot coexist with React
        18). Global act() flush in `ci/jestSetup.js` absorbs React 18's deferred
        passive effects before jsdom teardown (was crashing workers). Removed-API
        fixes: ViewPropTypes/Text.propTypes in `Button.js`.
    -   **Test state: FULL GREEN — 333/333 suites (1483 tests), zero failures**
        after the rehab pass: shared `testUtils/domNodeStub.js` (createNodeMock) +
        `testUtils/mockFirebase.js`, per-suite backend-function mocks (NOTE: spread
        of `jest.requireActual` crashes on this codebase's circular re-exports —
        use the Object.create prototype trick), correct-for-web assertions
        (`findByType(Text)` not `'Text'`, `UNSAFE_getByProps({testID})` since
        testID becomes data-testid on hosts), and memoized store stubs — fresh
        objects from stubbed `getState` made react-redux 8's useSyncExternalStore
        loop forever, which was the real cause of the "Call retries exceeded"
        worker crashes. `__DEV__` + `caches` globals added to jestSetup.
    -   **RNGH web patch** (`replacement_node_modules/react-native-gesture-handler/ web/GestureHandler.js`): RNW 0.19+ removed `findNodeHandle` (throws), which
        killed every gesture-handler attachment at mount (staging QA finding).
        The patch resolves the DOM node directly from the ref.
    -   Three latent app-source bugs flagged during rehab (not fixed, pre-existing):
        bare `caches` reference in `utils/Observers.js` (`typeof` guard needed),
        unguarded `findDOMNode` deref in `SocialText.js`, `lastVisitedScreen`
        array assumption + in-place mutation in `URLSystem/URLSystem.js`.
    -   **Remaining Stage 2 exit criteria**: user's logged-in gesture QA on staging
        (RNGH patch verification: swipes, taps, drag & drop), then the merge
        decision. First staging QA round passed everything except the RNGH gesture
        attachment; backend 500s/CORS in that log are staging-infra, not build.

## What this plan deliberately does NOT do

-   No Expo SDK upgrade treadmill (36→57) — the native targets it serves are not shipped.
-   No component-dialect rewrite (RN-web JSX stays; React Strict DOM or plain React is a
    future option, not a migration requirement).
-   No touching of `functions/` beyond the lockstep `yjs` bump in stage 4 (functions
    updates are Phases 0–1 of `DEPENDENCY_UPDATE_PLAN.md`).
