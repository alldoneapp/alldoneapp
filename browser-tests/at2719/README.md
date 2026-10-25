# AT-2719 — object titles and browser history

The shared URL helpers used to set `document.title` before changing the URL.
Chromium saves that title on the entry being left, so opening “Workflow Feature”
from tasks could label the tasks URL with the note's name. The fix changes the
URL first, then sets the title. The History API's second argument does not set
the page title ([HTML standard](https://html.spec.whatwg.org/multipage/nav-history-apis.html#dom-history-pushstate)).

All route helpers use `URLSystem/browserHistory.js`. A write to the current URL
refreshes the existing entry, preserving Forward on view remounts and avoiding
duplicate direct-load entries. Browser pop events route the selected URL through
`SharedHelper`, while the in-app close buttons keep their object-skipping stack.
Assistant titles use the loaded project synchronously, like other object views,
so a delayed backend response cannot stamp a title on another view.

Run on Node 22 with root and `web-bundler` dependencies and Playwright Chromium:

```sh
npm test -- --runInBand __tests__/URLSystem/BrowserHistoryTitles.test.js __tests__/URLSystem/SharedHelperHistoryPop.test.js URLSystem/Tasks/URLsTasksHistory.test.js utils/sheetHistoryLayers.test.js
node browser-tests/at2719/run.js
```

An external Playwright install can be selected with `PLAYWRIGHT_MODULE` and
`PLAYWRIGHT_BROWSERS_PATH`. Chromium's Linux shared libraries must be available.

The offline harness uses the real note/task/goal URL and title writers, with
project/store/backend dependencies replaced by fixtures. It reproduces the old
bug and inspects Chromium's own `Page.getNavigationHistory` entries, then tests
opening, tab changes, switching notes, closing, Back/Forward, direct note links,
reload and assistant mode. Its buttons and pop handler simulate view mounts;
they are not the full application UI. Jest separately exercises the actual
`SharedHelper` pop/close routing and existing object deep-link handlers.

No live Firebase login, object permissions, production deployment or Chrome
omnibox ranking is tested here. Existing stored Chrome history entries cannot
be rewritten by this fix; it corrects new navigations. Previously incorrect
suggestions can persist in a browser's old history.
