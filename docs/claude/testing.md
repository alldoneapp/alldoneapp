# Testing details

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## Testing

- Jest 30 on Node 22, jsdom environment (pinned explicitly in the config — jest 25's
  default, which suites depend on), babel-jest through the root `babel.config.js`
- Tests in `__tests__/` mirror component structure; newer tests sit next to their code
- Firebase mocks in `__mocks__/`
- Maintain 10% coverage thresholds
- **Transforms are allowlisted, not blanket** (Stage 5): `transformIgnorePatterns` in
  package.json names the only node_modules that go through babel — the ESM chain
  (`quill*`, `parchment`, `react-quill-new`, `lodash-es`, `lib0`, `y-*`, `yjs`) and the
  RN-era untranspiled dialect (`react-native*`, `expo*`, `@react-native*`…). A new dep
  that throws `SyntaxError: Unexpected token 'export'` in tests belongs in that allowlist.
  The old transform-everything hack died with jest 30 (jest loads its own runner through
  the transforming runtime). Root `babel.config.js` is an explicit web config on modern
  @babel/core mirroring web-bundler's shipped semantics — sloppy-mode CJS, block-scoping
  to var, set-semantics class fields, flow without pragma, classic JSX — plus
  transform-runtime with the real runtime version so `import * as X` namespace objects are
  shared across modules (suites that mutate a mock through a namespace import rely on it).
- **`setImmediate` in tests is guarded against outliving its file** (`ci/jestPolyfills.js`).
  jest's jsdom environment has no `setImmediate`, so the polyfill hands tests Node's real one —
  which, unlike jsdom's own timers, is not cancelled when a file's environment is torn down.
  React's scheduler prefers it, so a passive effect queued at the end of a test could run after
  jsdom was gone on a busy runner, throw without `window`, and crash the whole `--runInBand`
  `test:web:full` run with "The `document` global was defined when React was initialized, but is
  not defined anymore" — in whichever unrelated file ran next, which is why no two occurrences
  (seven failed master pipelines, August–September 2026) pointed at the same suite. The
  `afterEach` `act()` flush in `ci/jestSetup.js` cannot catch it: `act` drains only work queued
  inside it. The guard drops an immediate whose environment is gone, the way jsdom drops its
  timers. A retry always passed, which is what made it look like a flaky test. Pinned by
  `__tests__/JestPolyfills.test.js`.
- **Functions suites**: `npx jest --config ci/jest.functions.config.js` (same Node 22).
  That config skips Babel for `functions/node_modules` (modern CJS runs natively) and
  resolves exports maps with the **node** conditions — under jsdom's default browser
  condition, jest 30 would resolve e.g. jwks-rsa's `jose` to its browser ESM build and
  fail at require time. CI's `test:web:changed` excludes `functions/` entirely, so the
  functions suite is a local check — drift CAN land on master unnoticed, and it does.
  **Run `npx jest --config ci/jest.functions.config.js functions` before pushing anything
  under `functions/`**; as of 2026-09-01 it is fully green (236 suites / 3247 tests), so a
  failure there is yours. The drift is rarely a broken behaviour — it is a stale test
  DOUBLE. `vmTargetTask.test.js` sat red for four days because "Harden Firestore access
  rollout" (`6009eabd85`) moved project membership from the user document's `projectIds`
  to the project document's `userIds`, and the double only seeded the user side; two of
  its cases then went on passing while asserting nothing, because everything failed at the
  project gate before reaching the check under test. When a double stops matching what the
  code reads, fix the double AND confirm the still-green cases are not green for the wrong
  reason. Three
  web-located "bridge" suites that require functions code
  (`__tests__/TwilioWhatsAppService.test.js`, `__tests__/Chats/copyChatToOtherProject.test.js`,
  `__tests__/Feeds/copyInnerFeedsToOtherProject.test.js`) run in the functions config
  instead (`BRIDGE_SUITES` in `ci/jest.functions.config.js`).
- **firebase-admin is pinned to ^13 — do NOT bump to 14 casually.** v14's top-level
  `require('firebase-admin')` export is only the `app` module: the entire legacy namespace
  API (`admin.firestore()`, `admin.auth()`, `admin.messaging()`, `admin.database()`,
  `admin.storage()`, `admin.credential.cert`, `admin.apps`) is gone, and this codebase has
  hundreds of those call sites (an attempted v14 deploy failed at source analysis on
  `admin.credential.cert`; tests did not catch it because they mock `firebase-admin`).
  Moving to 14 requires the full modular migration (`getFirestore()` etc.) as its own
  project. Convention going forward regardless: statics come from the modular subpath —
  `const { FieldValue, Timestamp } = require('firebase-admin/firestore')` — and tests that
  stub them must mock `'firebase-admin/firestore'`, not just `'firebase-admin'`.
