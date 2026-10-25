# AT-2759: Project context in selection popups

The goal picker and grouped @-mention lists (notes and contacts) show a shared
project header for every non-empty group, including the current project.
The remaining @ tabs (tasks, goals, chats) show the same header for their
current-project results. The search scopes and milestone controls are unchanged.

Run with Node 22 and installed root dependencies. In a fresh test environment,
prepare the same local shims and placeholder configuration used by CI:

```bash
cp -R -f replacement_node_modules/* node_modules/
node ci/writeTestEnv.js
npm test -- --runInBand --watch=false \
    components/Feeds/CommentsTextInput/MentionsModal/projectContext.test.js \
    components/Feeds/CommentsTextInput/MentionsModal/MentionsItemsGrouped.test.js \
    components/Feeds/CommentsTextInput/MentionsModal.recentOnOpen.test.js \
    components/Feeds/CommentsTextInput/MentionsModal.contactsSearch.test.js \
    components/Feeds/CommentsTextInput/MentionsModal.notesRecency.test.js \
    components/Feeds/CommentsTextInput/MentionsModal/mentionSearch.test.js \
    components/UIComponents/FloatModals/TaskParentGoalModal/useParentGoalSearch.test.js \
    components/UIComponents/FloatModals/TaskParentGoalModal/goalSelectionToggle.test.js
```

For the browser fixture, also install `web-bundler` dependencies and Playwright
Chromium with its system libraries, then run:

```bash
node browser-tests/at2759/run.js
```

`PLAYWRIGHT_MODULE` and `PLAYWRIGHT_BROWSERS_PATH` can point to an existing
installation. Screenshots are written to ignored `.build/`.

The browser checks the real grouped lists, shared headers and selectable rows
at 1280px and 390px. Search filtering and the surrounding panel are fixtures;
account services and rich text parsing are replaced. Jest checks the real
mention modal's remaining tabs and the existing goal-search/milestone behavior.
This does not replace authenticated end-to-end or real-device testing.

Reviewed fixture screenshots: [desktop](screenshots/desktop.png), [mobile](screenshots/mobile.png).
