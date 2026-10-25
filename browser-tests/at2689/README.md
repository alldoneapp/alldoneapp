# AT-2689: detail-view header tags

The harness mounts the real note, task, contact, user and chat tag lists with
React Native Web, real project/visibility tags (including private participant
avatars), and real copy/search/new-window buttons. Backend calls, navigation,
popup contents and assistant subscriptions are isolated. The assistant button
fixture reproduces the real control's dimensions.

Run with Node 22 and the existing root/web-bundler dependencies installed:

```sh
node browser-tests/at2689/run.js
```

The runner requires Playwright with an installed Chromium. If Playwright lives
outside the checkout, set `PLAYWRIGHT_HOME` to its package directory. Optionally
set `CHROMIUM_EXECUTABLE_PATH` to an existing browser binary. It also supports
`@sparticuz/chromium` installed beside Playwright for minimal Linux VMs.

Checks cover 240–1440 px viewports, expanded/collapsed sidebars, independent
narrow header containers, long/spaceless project names, German/English/Spanish
labels, private participant avatars, extra task tags, shared-viewer actions and
live resizing. Assertions check that primary tags share a row when space is
available, tags never overlap actions, content stays inside the header, and all
permitted note actions remain hit-testable. Copy/new-window clicks are exercised.
Screenshots are generated under the ignored `.build/` directory.

Targeted Jest regressions:

```sh
npm test -- --runInBand --watch=false __tests__/Tags/ProjectTag.test.js components/TaskDetailedView/Header/TagListSharedActions.test.js __tests__/TaskDetailedView/Header/TagListCalendarTag.test.js
```

For manual application verification, run `npm run dev`, open a note detail view
and resize the window with both sidebar states. Project and visibility remain a
single group; long project names ellipsize while keeping their full accessible
name. Extra task metadata wraps separately. If tags and actions cannot both fit,
actions move to a further row. Mobile keeps the existing compact tag/button mode.
