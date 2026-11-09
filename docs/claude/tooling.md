# Tooling, Node versions, web-bundler and patched node_modules

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

**Required versions**: Node 22.23.4 or newer within Node 22 (repo-wide, `.nvmrc`), npm 10, firebase-tools 13.29.3.
The minimum includes the October 2026 security fixes, including CVE-2026-111497.
Keep local pins and CI/runner Docker images on a patched Node 22 release. Firebase's
`nodejs22` runtime is managed separately; verify the actual base-image version in
Cloud Run logs instead of treating the major-version setting as proof of patching.
`npm run dev` and `npm run emulators` run `ci/prepare-local-emulators.js` before
startup. It adds an SDK-version guard to the pinned CLI's local Functions runtime:
SDK 7 removed `functions.config()`, which CLI 13 otherwise calls before every
invocation and crashes. The guard skips that legacy config helper for SDK 7+;
it does not change the Functions SDK or deployment commands. It is reapplied after
`npm ci`, and fails explicitly if the pinned CLI/runtime changes so the backport
can be reviewed or removed.
Local Auth and callable Functions requests use same-origin HTTPS proxies on the
webpack dev server (`/emulator/auth` and `/emulator/functions`); the latter forwards
to port 5001 with the project and region path. Hosted/native Functions keep their
configured regional endpoint.

Since migration Stage 5 the whole repo — installs (lockfile v3, `.npmrc` with
legacy-peer-deps), Jest, the web-bundler build, and Cloud Functions work — runs on
Node 22; the Node 14 / npm 6 / Expo/Metro CLI era is over. The retired RN-era scripts,
root webpack/Metro configs, Expo 36 package, and native React Native package were removed
in the 2026-09-16 dependency-hygiene pass. Application imports still use the
`react-native` dialect, but webpack and Jest both resolve it explicitly to
`react-native-web`; do not restore native tooling to make those imports resolve.

**web-bundler (migration Stage 0)**: `web-bundler/` is the standalone webpack 5
replacement for `expo build:web` (own lockfile, its own babel config). Since Stage 5 it is
no longer a Node-version carve-out — the whole repo is Node 22 — and it builds the app
source against the root `node_modules` (now also installed under Node 22 / npm 10) while
reproducing the exact `web-build/` output contract. Env injection stays sed-based outside
the bundler; the `replacement_node_modules` swap still applies before building. **Since
2026-08-04 this IS the deployed pipeline**: `build_web_production` (master) and `build_web_staging` (develop)
build through web-bundler on the Node 22 tooling image; `build_web_webpack_check` gives
feature branches compile signal (no deploy: see "Staging deploys only from `develop`"). The expo
build jobs are deleted; `npm run build-web` (expo) remains only as a local legacy script.
See `web-bundler/README.md`. **Strict-mode gotcha**: the
RN-era sloppy idiom `export default Name = (...)` (assignment to an undeclared identifier)
crashes under real ES modules with a `ReferenceError` that aborts the whole main chunk with
zero console errors — write `const Name = (...); export default Name` instead. Four
components were fixed for this during Stage 0; grep before assuming a blank page is a
bundler problem.

**Cloudflare worker tooling**: `cloudflare/email-worker/` uses the same patched Node 22 release as the repository via its own `.nvmrc`. The former Node 20 exception is retired; the deployed Worker itself runs on Cloudflare's managed Workers runtime.

**`replacement_node_modules/` full inventory** (the blanket `cp -R -f replacement_node_modules/* node_modules/` applies ALL of these after every install — when upgrading any of these packages, the patch must be re-derived or retired first, never blindly re-copied over the new version):

- Retired in migration Stage 4 (2026-08-10): `quill` (dist patch → `quill2Setup.js` app code, see above), `y-quill` (the yjs#474 workaround — fixed upstream in yjs 13.6, pinned by `components/NotesView/NotesDV/EditorView/yQuillBinding.test.js` and `__tests__/Yjs/yjs1347Compat.test.js`), and `y-webrtc` (the whole package was removed — notes collaboration has used `y-websocket` for years; the WebRTC path was dead code).
- `@hello-pangea/dnd` (v18.0.1) — adds `index` to the drag `combine` payload (pointer
  path); `DragHelper.onDragEnd` needs the combine target's index to sort a task dropped
  onto another task (consumed at `components/DragSystem/DragHelper.js:645`). Carried over
  from the retired react-beautiful-dnd patch; patches `dist/dnd.esm.js` + `dist/dnd.cjs.js`,
  which are still `module`/`main` in v18, so those two files cover both webpack and jest.
  **Re-derived against pristine v18 in Stage 6 and now a 4-line diff against upstream** —
  keep it that way. The previous v16 copy had been prettier-formatted, which made it diff
  at 14,089 lines and rendered the actual change invisible; `.prettierignore` excludes
  `replacement_node_modules` precisely so these files keep upstream's formatting. When
  bumping this package, diff the vendored file against the new pristine dist and re-apply
  the one `index:` line — do not let the blanket `cp` carry the old bundle over a new
  install (it produced a silent v18-metadata/v16-code hybrid exactly once already).
- `react-native-gesture-handler` — four-file compatibility patch for
  react-native-web ≥0.19: `GestureComponents.web.js` guards the removed
  `DrawerLayoutAndroid` (unguarded `.positions` crashed module eval);
  `web/GestureHandler.js` resolves the DOM node from the ref (`findNodeHandle`
  now throws) and reads event callbacks through the threaded wrapper instance
  (refs are DOM nodes without `.props`); `RNGestureHandlerModule.web.js` +
  `createHandler.js` thread that wrapper through `attachGestureHandler`
  (extra argument, ignored on native).
- `react-dismissible`, `react-tiny-popover` — modal dismiss-behavior **and positioning**
  patches (see the popover notes below, including "a popover that fits nowhere").
- `react-native` (`VirtualizedList`/`FlatList`) — native-era patches; inert on web
  (the web bundle aliases react-native → react-native-web).
- `expo-font` — obsolete since migration Stage 1 (app uses `utils/WebShims/Fonts.js`);
  inert.
- Retired in migration Stage 2: `react-native-web` (TouchableOpacity dismissible-touch
  hook → now a document-level capture listener in `AppNavigator.js`; ScrollViewBase
  `onScrollWhenDisabled` → had no users; TextInput `outline: none` → covered by the
  global `*:focus` rule) and `react-beautiful-dnd` (→ the @hello-pangea/dnd patch above).
