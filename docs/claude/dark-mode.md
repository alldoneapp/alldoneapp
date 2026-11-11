# Light / dark mode

Added 2026-11-11. Read this before touching colors, `components/styles/global.js`,
`Themes/`, or any new screen.

## How it works

- `Themes/colorMode.js` owns the mode. Preference `auto` (default) | `light` | `dark`;
  `auto` follows `prefers-color-scheme`, which the browser, the iOS app (Capacitor
  WKWebView) and the Android app (TWA) all report from the device setting, and it switches
  live when the OS switches (e.g. at sunset).
- Every color that differs between modes is a CSS custom property `var(--ad-<Token>)`.
  react-native-web passes `var(...)` colors straight to the DOM (`isWebColor`), so
  `StyleSheet.create` at module load still flips live: switching only changes
  `data-theme` on `<html>`, no reload or re-render.
- Palettes: `LIGHT_PALETTE` / `DARK_PALETTE` in `colorMode.js`. The `*100…*150` tints of
  the Utility families are derived in dark mode (accent mixed into the dark surface).
- `colors` in `components/styles/global.js` maps neutrals, text and tints to tokens
  (`colors.Text01`, `colors.Surface`, `colors.Grey300`, …). Accents (`Primary*`,
  `Secondary*`, `Utility*200/300`, project colors) stay hex and read fine on both.
- `Themes/ThemedColors.js` is the display version of `Themes/Colors.js`, used by the light
  ("modern") sidebar and top bar themes.
- Storage: `localStorage['alldone.colorMode']` (device, read by the inline boot script in
  `web-bundler/index.html` so the first paint and the `theme-color` meta are already right)
  and `users/{uid}.colorMode` (follows the user; `RootView` applies it). Settings row:
  `components/SettingsView/Customizations/Properties/Appearance.js`.
- The older "App theme" setting (`themeName`, Blue/Light) is the sidebar style and was
  relabelled "Sidebar theme" (Blue/Neutral). It is independent of light/dark.

## Rules

- New UI: use `colors.Surface` (not `'#ffffff'`) for backgrounds and `colors.Text0x` for
  text. White text/icons on colored buttons stay `'#ffffff'`.
- Never store a token. Values written to Firestore (highlight `hasStar`, project colors,
  editor text/background colors, `Themes/Colors.js`) stay plain hex.
- Stored light colors are mapped for display: `getHighlightDisplayColor(hex)` (dark tint of
  the same hue; white = surface), `adaptiveColor(hex)` (a `var()` doing the same for a
  hardcoded pastel background), and `PROJECT_COLOR_SYSTEM` tints are adaptive already.
- Anything that needs a concrete color (Animated color `interpolate`, canvas, three.js,
  chart libraries) must call `resolveColor` / `resolveColors` / `resolveSurfaceColor` and
  re-render through `useColorMode()`. Animated interpolation of a `var(...)` breaks.
- Alpha: `alphaColor(token, a)` or `hexColorToRGBa(token, a)` (delegates). Never
  concatenate (`colors.Text03 + '33'`) on a token.
- Plain CSS files use `var(--ad-<Token>, <light fallback>)`. A light background without a
  token uses `var(--ad-hl-RRGGBB, #RRGGBB)` and must be listed in `CSS_ADAPTIVE_COLORS`.
- Navy popovers (`Secondary400`) intentionally stay navy in both modes.
- Never derive a background from a text token (`hexColorToRGBa(colors.Text01, …)`): `Text01`
  is near-white in dark mode. Floating bars with white text (the Undo bar) use `themed.Snackbar`.

## Known gaps (not yet themed)

- Login / onboarding / public booking pages that import `Themes/Colors` directly still use
  light colors where they hardcode them.
- Remaining hardcoded hex values that are not exact palette matches (e.g. one-off greys)
  and HTML/email templates rendered into iframes.
- Unstyled `<Text>` falls back to react-native-web's black.

Tests: `Themes/colorMode.test.js`.
