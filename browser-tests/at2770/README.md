# AT-2770: New Day in assistant mode

Run with Node 22, the existing repository dependencies, and an external Playwright/Chromium installation:

```sh
NODE_PATH=/path/to/playwright/node_modules node browser-tests/at2770/run.js
```

The focused development bundle uses a 1536 MB Node heap. Screenshots are written to the ignored `.build/` directory. Use `--skip-build` to rerun an existing bundle. `PLAYWRIGHT_BROWSERS_PATH`, `LD_LIBRARY_PATH` and `FONTCONFIG_FILE` can point to a locally provisioned browser, libraries and fonts on minimal VMs.

The harness renders the shipped New Day, confirmation, mandatory reload and optional reload components inside the shipped `WorkspaceOverlayLayer`. It supplies a synthetic Redux account with no projects, network stubs and a sidebar placeholder. It checks 390 px and 1440 px viewports, mounting identity across layout changes, visible bounds, starting the day, both reload callbacks and confirmation dismissal. It makes no production requests and replaces reload with a counter.

This is component integration coverage; the full authenticated app and real assistant shell are not started. `__tests__/AppContentGlobalDialogs.test.js` separately covers actual `AppContent` mounting. Existing pane placement is preserved: split-view dialogs stay inside Alldone, and chat-only mode hides them. Whether these dialogs should instead cover the whole app and remain visible in chat-only mode is still awaiting product clarification.
