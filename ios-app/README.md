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

## Native Share Extension

The `ShareExtension` target adds Alldone to the iOS share sheet for web links
and plain text. It opens a small native task composer with the shared URL
prefilled. The user can edit the text, then press Return or **Add** to create
the task. It is initially written to a writable project and stamped for the
same automatic project-routing pipeline used by All Projects.

The extension cannot use the web app's Firebase session, so the signed-in
Capacitor app provisions a narrowly scoped, revocable share token through
`mintIosShareExtensionToken`. The token and endpoint are shared with the
extension through App Group `group.app.alldone.ios`; logout revokes the token
and clears it locally. A newly installed native release must be opened once
while signed in before its Share Extension can add tasks.

Before an archive can be signed, register both the Share Extension bundle ID
(`app.alldone.ios.ShareExtension`) and App Group (`group.app.alldone.ios`) in
the Apple Developer account, then enable the group for both targets' signing
profiles. This is a native-shell change and therefore requires a TestFlight or
App Store release; OTA cannot add the target or entitlement.

Release in this order:

1. Deploy `mintIosShareExtensionToken`, `revokeIosShareExtensionToken`, and
   `iosShareTask`.
2. Deploy/sync the web bundle that provisions the scoped credential.
3. Archive and release the native app with the Share Extension embedded.

## Verified so far (2026-08-19, simulators + iPad Air 5 device, staging)

- Web bundle boots cleanly from `capacitor://localhost` (login screen pixel-correct)
- Native Google sign-in end to end (system consent → accounts.google.com →
  logged-in workspace)
- Session persists across app termination/relaunch (IndexedDB persistence)
- Sign in with Apple end to end on a real device (needs `apple.com` in the
  plugin's `providers` list — without it the sheet never opens; simulators
  cannot verify this flow at all)
- Content flows edge-to-edge under the home indicator (AT-2321 reservation
  removed repo-wide; ChatInput lifts itself via useHomeIndicatorLift)

## Over-the-air updates (working, self-hosted)

Every web deploy publishes itself as an OTA bundle (`ci/buildOtaBundle.js`,
runs inside web-bundler's npm build): `/ota/latest.json` + an immutable
`/ota/bundle-<sha>.zip` on the same Firebase Hosting as the web app (CORS for
`/ota/**` is in firebase.json — a capacitor:// origin cannot read it
otherwise). The shell checks on boot/foreground (`utils/shellOtaUpdater.js`),
downloads through `@capgo/capacitor-updater` (manual mode), applies with
auto-rollback, and only `channel: 'ci'` bundles ever update (local dev builds
stay put). Two hard-won invariants: `notifyAppReady()` fires at module
evaluation — racing the 60s `appReadyTimeout` against full app bootstrap
loses on slow boots and produces an endless download→revert loop — and the
E2E was verified in the simulator including an update applied while logged
in. Store releases are now only needed for native shell changes.

## Assistant voice calls in the background (AT-2496)

The assistant call is a WebRTC connection inside the WKWebView
(`components/UIComponents/AssistantVoiceCallButton.js`). Two native pieces let
it keep running when the user presses Home or locks the screen:

- `UIBackgroundModes: audio` in `ios/App/App/Info.plist`. WebKit proxies the web
  view's AVAudioSession into the host app, so this mode is what keeps the app
  (and with it the capture and the peer connection) alive in the background.
  Without it iOS suspends the app seconds after it leaves the foreground and the
  call dies. App Store review accepts it because the app really does play and
  record audio in the background during a call.
- `CallAudioSessionPlugin.swift` (`CallAudioSession` on `window.Capacitor.Plugins`).
  The web side calls `begin()` before it opens the microphone (category
  `.playAndRecord`, mode `.voiceChat`, Bluetooth + speaker allowed) and `end()`
  after it has stopped its tracks. `begin()` reports `backgroundAudio`, i.e.
  whether the running build carries the mode above, so an older shell logs a
  warning instead of promising a background call it cannot deliver. All of this
  is a no-op outside the shell (`utils/CapacitorShell.js`).

Both are native shell changes and need a TestFlight / App Store release; OTA
cannot add a background mode. Verify on a device, not the simulator: start a
call, press Home, keep talking for a minute, lock the screen, return — the
transcript in the call topic must show the turns spoken while backgrounded.

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
