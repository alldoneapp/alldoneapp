# AT-3046: Assistant sidebar activity rows as cards (variant C)

```bash
npm test -- --watch=false components/Anna/AnnaActivityNotice.test.js components/Anna/AnnaConversation.test.js
node browser-tests/at3046/run.js [--skip-build] [--shots <dir>]
```

The harness mounts the real `AnnaActivityGroup` with `anna.css` and Anna's theme variables. Its
rows cover a single reply, a long title and preview, a grouped state change plus reply, a read
row, a row from another project, a row from another actor, a row that is not enriched yet, and
the project-switch and view notices. It runs in dark and light mode at 300, 380 and 560px desktop
sidebar widths and asserts the following:

- nothing leaves the pane;
- titles are one line with an ellipsis and the time stays whole on that line;
- previews have at most 2 lines and labels are one line with their icon;
- `Project · Actor` appears only on the two foreign rows;
- the edge is accent for unread rows and border grey for read ones;
- hover turns the border blue;
- the system notices are one-line dividers.

Needs `web-bundler/node_modules`, `replacement_node_modules` copied into `node_modules`, and
Playwright/Chromium (`PLAYWRIGHT_MODULE`, `CHROMIUM_EXECUTABLE_PATH`).
