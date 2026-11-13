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
- Popups are navy in light mode and one raised neutral card (`#1C2230`, the dark
  `SurfaceRaised`) in dark mode, and the Undo bar uses the same card. Tokens:
  `colors.Secondary400` (card), `Secondary300` (rows, hover, dividers) and `Secondary200`
  (chips, inner buttons) are `Popup`, `PopupRaised` and `PopupControl`; an edit form's field
  is `themed.PopupFieldBorder` + `PopupFieldFill`, its button bar `themed.PopupField` (recessed,
  darker than the card in dark mode); the card shadow is `themed.PopupShadow` (adds a hairline
  ring in dark mode). Never hardcode `'#091540'` / `'#162764'` or the shadow literal.
  three.js / canvas code that wants the navy uses the hex.
- Popup content keeps the LIGHT palette in dark mode. It was designed for a navy card, so it
  uses light tokens (`Text04`, `Grey400`, `UtilityBlue125`) as text. `colorMode.js` re-declares
  every token except the popup's own surfaces with its light value inside
  `.react-tiny-popover-container` and `[data-ad-popup]` (the bottom sheet sets
  `dataSet={{ adPopup: 'true' }}`). A new popup surface outside those two needs that dataSet.
  Consequence: a popup whose root is `colors.Surface` stays white in dark mode.
- The way back: a card designed for the page that renders inside a popup (the VM agent
  question/approval card, `VmInteractionCard`, in a task's comment popup) marks its root with
  `dataSet={{ adPagePalette: 'true' }}` (`data-ad-page-palette`, `PAGE_PALETTE_SCOPE_ATTRIBUTE`).
  In dark mode that re-declares the dark values of every popup-scoped token (alpha variants and
  `modeColor` pairs included), so `colors.Grey100`, `Text01`, `UtilityBlue100` mean what they mean
  on the page. No effect in light mode or outside popups. Before 2026-11-13 the card was a white
  panel in the dark comment popup (AT-3039). Pinned by `Themes/colorMode.test.js` and
  `VmInteractionCard.test.js`.
- Blue text on a blue tint (milestone date chips) uses `themed.AccentText`, not `Primary300`,
  which is too dark on the dark tint. For a runtime pair with no token (a project's own colour),
  `modeColor(lightValue, darkValue)` returns one `var()` that flips with the mode.
- Lines and fills that carry structure on a project card do not use the adaptive project tints:
  those are quiet backgrounds, and a violet project's goal frame came out at 1.05:1 on the dark
  card (blue at 1.5:1), so the task board lost its structure. `PROJECT_COLOR_SYSTEM` has its own
  entries, the light pastel in light mode and the project colour mixed to a fixed contrast against
  the dark card (`tintForContrast`): `PROJECT_ITEM_SECTION_BORDER` (the frame around a goal and its
  tasks, 2:1; `ProjectSection` supplies it through `useProjectSectionBorder`), `PROJECT_GOAL_BAR`
  (goal progress fill, 1.3:1) and `PROJECT_GOAL_BOX_BORDER` (the empty percentage box). A new
  divider or outline on a project card takes one of these. Pinned by
  `Themes/Modern/ProjectColors.test.js`.
- A class component that resolves Animated colors in `render()` has no `useColorMode()`; it
  subscribes with `subscribeColorMode` and re-renders (see `GoalItemPresentation`).
- Never derive a background from a text token (`hexColorToRGBa(colors.Text01, …)`): `Text01`
  is near-white in dark mode. Floating bars with white text (the Undo bar) use `themed.Snackbar`
  and `themed.SnackbarShadow`.

## Known gaps (not yet themed)

- Login / onboarding / public booking pages that import `Themes/Colors` directly still use
  light colors where they hardcode them.
- Remaining hardcoded hex values that are not exact palette matches (e.g. one-off greys)
  and HTML/email templates rendered into iframes.
- Unstyled `<Text>` falls back to react-native-web's black. Give text a `colors.Text0x` color
  (the boot loading screens were black on the dark surface until this was fixed).

Tests: `Themes/colorMode.test.js`.
