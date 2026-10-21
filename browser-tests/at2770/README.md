# AT-2770 / AT-2789: Global dialogs and reload in assistant mode

Run with Node 22, the existing repository dependencies, and an external Playwright/Chromium installation:

```sh
NODE_PATH=/path/to/playwright/node_modules node browser-tests/at2770/run.js
```

The focused development bundle uses a 1536 MB Node heap. Screenshots are written to the ignored `.build/` directory. Use `--skip-build` to rerun an existing bundle. `PLAYWRIGHT_BROWSERS_PATH`, `LD_LIBRARY_PATH` and `FONTCONFIG_FILE` can point to a locally provisioned browser, libraries and fonts on minimal VMs.

The harness renders the shipped New Day component and `GlobalModalsContainerApp`, including the real confirmation, mandatory reload, optional reload and timeout components and their `WorkspaceOverlayLayer` hosts. It supplies a synthetic Redux account with no projects, network stubs and a sidebar placeholder. It checks 390 px and 1440 px viewports, mounting identity across layout changes, visible bounds, starting the day, all three reload callbacks in normal, split and chat-only layouts, optional-banner dismissal, and confirmation dismissal. It makes no production requests and replaces reload with a counter.

This is component integration coverage; the full authenticated app and real assistant shell are not started. `__tests__/AppContentGlobalDialogs.test.js` separately covers actual `AppContent` mounting. AT-2789 closes the gap left by AT-2770: reload prompts fall back to the browser viewport whenever the Alldone pane is hidden (chat-only, mobile chat, or a different assistant workspace surface). Visible split-view panes and the normal view retain their existing placement. New Day and unrelated dialogs keep their existing pane scope. The new `__tests__/UIComponents/GlobalReloadPopups.test.js` checks this routing, retained instances, callback invocation and dismissal without backend credentials.

```sh
npm test -- --runInBand --watch=false __tests__/AppContentGlobalDialogs.test.js \
    __tests__/UIComponents/GlobalReloadPopups.test.js \
    __tests__/utils/ObserversVersionReload.test.js
```

Review screenshots: [desktop chat reload](../../docs/screenshots/AT-2789-chat-reload-desktop.png), [mobile chat reload](../../docs/screenshots/AT-2789-chat-reload-mobile.png). Real-device Safari/iOS and the fully authenticated production app are not covered by this fixture harness.

Verification on the task VM: 44 tests passed across the six suites for global reload popups, AppContent dialogs, version reload, daily reload, New Day helpers and day coordination. The webpack harness compiled and passed at both widths. The additional existing `__tests__/FloatModals/EndDayStatisticsModal.test.js` suite could not bootstrap without the checkout's Firebase `.env` values; the browser harness independently checks the real New Day component using fixture transport.
