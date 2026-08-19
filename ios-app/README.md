# Alldone iOS app (Capacitor shell)

A [Capacitor 8](https://capacitorjs.com) shell (bundle id `app.alldone.ios`)
that ships the **same web bundle** the web/PWA/Android platforms use. Unlike the
Android TWA (which renders the live site), iOS bundles the web build into the
app — so shipping a web change to iOS means re-running the sync (or, later, the
OTA update channel; see Roadmap).

## How it fits the one-codebase model

- Web code changes: made in the normal app source, nothing iOS-specific except
  branches gated on `isCapacitorShell()` (`utils/CapacitorShell.js` at the repo
  root). The web bundle has **no npm dependency on Capacitor** — inside the
  shell, plugins are reached via the injected `window.Capacitor.Plugins`
  global. Keep it that way: a root dependency change forces new CI images.
- Native shell changes (plugins, Info.plist, icons): live here, rare.

## Build & run (development, points at staging via root `.env`)

```bash
# 1. at the repo root
npm run build-web-webpack
# 2. here: copy web-build into www/ + cap sync
./sync-web.sh
# 3. build + run (any iOS way works, e.g. Xcode: ios/App/App.xcodeproj)
```

## Native Google sign-in (working)

Google blocks OAuth in WKWebView (`disallowed_useragent`), so the shell signs
in natively:

- Plugin: `@capacitor-firebase/authentication` with `skipNativeAuth: true` in
  [capacitor.config.json](capacitor.config.json) — the **web** Firebase SDK
  stays the single owner of the auth session; the plugin only produces a
  Google ID token.
- Web side: `signInWithGoogleRedirect()` in `utils/backends/firestore.js`
  branches to the native plugin when `getNativeGoogleAuthPlugin()` returns one,
  then calls `signInWithCredential` — same session, persistence, and
  `isNewUser` handling as the web popup path. Cancelling the native sheet
  resolves to `null` (not an error).
- Native side needs two per-environment pieces, switched together by
  **`./set-env.sh staging|production`**: the bundled
  `ios/App/App/GoogleService-Info.plist` (from `firebase/`, client configs —
  same publicness class as the web Firebase config) and the matching
  `REVERSED_CLIENT_ID` URL scheme in `Info.plist`. Staging is the committed
  default. Note the web bundle is switched separately: a production shell
  build needs the CI-built production web bundle, not a local
  `build-web-webpack` (which uses the root `.env` = staging).

The plist is referenced in `App.xcodeproj/project.pbxproj` as a bundled
resource (ids `AB00DDEE...FF`).

## Verified so far (2026-08-19, iPhone 17 Pro simulator, staging)

- Web bundle boots cleanly from `capacitor://localhost` (login screen pixel-correct)
- Native Google sign-in end to end (system consent → accounts.google.com →
  logged-in workspace)
- Session persists across app termination/relaunch (IndexedDB persistence)

## Roadmap (in order)

1. **Push notifications** — `@capacitor/push-notifications` via APNs/FCM,
   registering tokens into the existing `pushNotifications` pipeline. Needs an
   Apple Developer account ($99/yr).
2. **Apple sign-in** — required by App Store review once Google sign-in is
   offered (guideline 4.8).
3. **OTA updates (Capgo)** — CI uploads the same web bundle to an update
   channel so iOS tracks web deploys without store releases.
4. **Store payments compliance** — hide Gold/premium purchase UI inside the
   iOS shell (v1), or adopt StoreKit IAP (later decision).
5. Device testing + TestFlight + App Store listing.
