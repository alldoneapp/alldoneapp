# Alldone Android app (Trusted Web Activity)

A [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)-generated Android
shell that opens https://my.alldone.app full-screen in Chrome (a TWA — real
Chrome, not a WebView). Because it renders the live site, **every Firebase
Hosting deploy updates the app automatically**; nothing here needs rebuilding
for normal releases.

- Package id: `app.alldone.android` (permanent after the first Play upload)
- Config: `twa-manifest.json` (note the version field is `appVersion`, not
  `appVersionName` — bubblewrap silently emits an empty `versionName` otherwise)
- Toolchain: JDK 17 + Android SDK auto-installed by bubblewrap in `~/.bubblewrap`

## Build

```bash
export BUBBLEWRAP_KEYSTORE_PASSWORD=$(grep storePassword keystore.properties | cut -d= -f2)
export BUBBLEWRAP_KEY_PASSWORD=$(grep keyPassword keystore.properties | cut -d= -f2)
npx bubblewrap update --skipVersionUpgrade   # regenerate project from twa-manifest.json
npx bubblewrap build --skipPwaValidation     # → app-release-signed.apk + app-release-bundle.aab
```

Upload `app-release-bundle.aab` to the Play Console. For a shell release, bump
`appVersionCode` (and `appVersion`) in `twa-manifest.json` first — Play requires
a strictly increasing versionCode. Only shell changes (icon, splash, target SDK
bumps, manifest colors, share-target intent filters) need a Play release at all.

## Signing (NOT in git)

`android.keystore` + `keystore.properties` are gitignored. The upload key's
SHA-256 fingerprint:

```
BA:B4:BA:6B:A7:B3:0C:E2:C2:9A:33:5C:74:89:E8:1E:D4:B3:BE:63:9F:69:93:96:A1:04:A1:4E:B7:3E:8D:A7
```

Back both files up (password manager). With Play App Signing (the default),
Google re-signs what users install, so losing the upload key is recoverable via
Play support — but still annoying.

## Digital Asset Links (what removes the browser URL bar)

The TWA is only allowed to run full-screen when
`https://my.alldone.app/.well-known/assetlinks.json` vouches for the app's
signing certificate. **Firebase Hosting auto-serves that file** from the Android
apps registered in the Firebase project (it currently serves `[]` — that's the
auto-generation with zero apps registered). Do not add a static file instead:
`firebase.json`'s hosting `ignore` contains `**/.*`, so a `.well-known/` file in
`web-build/` would be silently excluded from deploys.

Setup (Firebase console, production project `alldonealeph`):

1. Project settings → Your apps → Add app → Android, package `app.alldone.android`.
2. Add the **upload key** SHA-256 above (makes locally-built APKs verify).
3. After the first Play upload: Play Console → Test and release → Setup →
   App signing → copy the **App signing key certificate** SHA-256 and add it as
   a second fingerprint in the same Firebase screen (makes the Play-installed
   app verify). Done 2026-08-19; the verified Play App Signing cert is
   `5E:9B:A8:9B:97:EB:5E:E2:FB:F8:B4:6E:5D:49:67:B9:D6:58:C5:CF:AD:52:AF:09:7F:EB:DB:A4:91:9D:AD:91`
   (read directly off the Play-installed APK with `apksigner verify
--print-certs` — the App signing page has many similar-looking rows and the
   first copy grabbed a wrong value, so verify against the APK if in doubt).
4. Check `curl https://my.alldone.app/.well-known/assetlinks.json` lists both.

If the Play-installed app shows a URL bar even though the fingerprint is
correct, Chrome cached a failed verification: force-stop both Chrome and the
app (or clear Chrome's cache) and relaunch.

Without step 3 the Play-installed app still works but shows a Chrome URL bar.

## Local testing

```bash
npx bubblewrap install   # installs app-release-signed.apk on a connected device/emulator
```

The URL bar disappears only once the asset links above are live.

## Assistant voice calls in the background (AT-2496)

Nothing in this shell is involved: a TWA renders in Chrome, so Chrome owns the
microphone and its own "microphone in use" foreground notification, and keeps
the tab alive while it captures — with the app in the background or the screen
locked. The web side registers the call as a Media Session
(`components/UIComponents/assistantCallBackground.js`), which is what gives
Chrome's ongoing notification its title and a hang-up button. No extra
permission is declared here on purpose: `RECORD_AUDIO` belongs to Chrome, not to
the TWA package. Verify on a device: start a call, press Home, keep talking,
lock the screen, return — the call topic's transcript must contain the turns
spoken while backgrounded.
