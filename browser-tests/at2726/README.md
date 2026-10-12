# AT-2726: Milestone swipe release

The harness renders the real upcoming milestone row, React Native Web touchable,
Swipeable, global modal container and reminder date picker. Backend writes and
unrelated leaves are replaced with fixtures; it does not connect to Firebase.

With Node 22, the existing root/web-bundler dependencies and Playwright Chromium:

```sh
node browser-tests/at2726/run.js
```

Set `PLAYWRIGHT_MODULE` to an installed Playwright module if it is outside the
checkout, and `PLAYWRIGHT_BROWSERS_PATH` if its browser cache is elsewhere.
`--skip-build` reuses the previous harness build. `HARNESS_SCREENSHOTS=1` updates
the screenshots; `HARNESS_DEBUG=1` logs browser requests and dismissal events.
The HTML includes the app's global flex-basis reset and its bundled fonts.

Checks run with both mouse input and Chromium touch emulation:

- Normal row navigation before a swipe.
- Real left drag, reminder background translation and release without Goals navigation.
- Visible, clickable date selection and a project write with tomorrow's date;
  the milestone date remains unchanged.
- The project-row control opens the same picker.
- A forced compatibility click immediately after release cannot navigate.
- Close button, backdrop dismissal, repeated swipes and restored normal navigation.

The mobile backdrop check waits beyond the existing 750 ms opening-gesture guard.
Screenshots show the desktop picker and mobile sheet. These checks do not replace
a physical-device test or verify production backend persistence.

The DOM regression suite additionally drives release plus click through real RNW
touchables and the global modal container (with a stub picker):

```sh
npm test -- --runInBand components/TaskListView/Header/ProjectPostponeSwipe.dom.test.js
```
