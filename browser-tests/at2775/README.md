# AT-2775: one expanded statistics row

The compact topbar's three-dot menu now reveals XP/level, Gold, completed tasks
(and points when enabled), and Premium/free quota in one 36px row instead of two
36px rows. Normal screenshot values fit at 360px and above. Narrower widths,
large counters and extra points can scroll horizontally; counters and navigation
remain available. Wider mobile headers retain Gold in the primary row. Desktop
layout is unchanged.

The harness mounts the real TopBarContainer, mobile/desktop headers, three-dot
control, XP/progress/avatar, Gold, task statistics, Premium/quota, themes and
React Native Web. Account subscriptions and navigation use local fixtures.
Assistant workspace/connection monitoring are placeholders. External requests
are blocked. This is component-browser verification, not an authenticated app
or physical-device check.

With Node 22, root/web-bundler dependencies and Playwright Chromium installed:

```bash
node browser-tests/at2775/run.js
npm test -- --runInBand --watch=false \
    --testPathPatterns='components/TopBar/|utils/Levels.test.js|utils/responsiveLayout.test.js|components/RootView/GoldAnimationsContainer.test.js|components/RootView/GoldCoins/.*test.js'
```

`PLAYWRIGHT_HOME` can point to an existing installation. `CHROMIUM_EXECUTABLE_PATH`
selects a browser binary; the runner also supports `@sparticuz/chromium` beside
Playwright. Minimal VMs may need local NSS/NSPR libraries and a FONTCONFIG_PATH
whose fonts.conf points to available fonts. `HARNESS_OUTPUT` sets the ignored
build/screenshot output directory. `--skip-build` reuses its bundle.

Checks cover 50 cases: widths 320, 360, 384, 390, 430, 600, 768, 1024, 1280 and
1440px, each with Premium, free quota, large balances plus completed points,
classic colors, and anonymous viewing. Assertions cover initial collapse,
expansion via the real menu, one-row height/alignment, no overlapping counters
or following content, page overflow, and clicking every statistics control
(including scrolling to reach it). Mounted resizing covers 384→600→320→430→1280→384.

For desktop comparisons, compile/run this harness against the original
TopBarMobile source with `--baseline` and a separate HARNESS_OUTPUT. Then run
the fixed bundle with `DESKTOP_BASELINE` pointing to that directory. The 15
screenshots at 1024, 1280 and 1440px must match (at most two shadow-edge
pixels may differ by one color step due to Chromium rounding). Baseline mode also
records the original 72px expanded height at 384px. `--desktop-only` reruns
the desktop comparisons and mounted resizing.

[Mobile before](screenshots/mobile-before.png),
[mobile after](screenshots/mobile-after.png),
[desktop](screenshots/desktop.png).
