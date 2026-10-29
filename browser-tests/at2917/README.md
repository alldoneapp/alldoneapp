# AT-2917: narrow Assistant Mode chats never scroll sideways

```bash
npm test -- --watch=false components/Anna/annaChatHorizontalOverflow.test.js \
    components/Feeds/TextParser/CommentElementsParser.test.js \
    components/ChatsView/ChatDV/EditorView/MessageItemBody.test.js
node browser-tests/at2917/run.js
```

The harness mounts the real `AnnaMessageBody`/`MessageItemBody`, `CommentElementsParser`,
`CustomImage` and `AnnaActivityGroup` inside the assistant shell's DOM and `anna.css`. At
340–720px chat widths it asserts that `.anna-messages` has no horizontal scroll range, that a
sideways wheel swipe moves nothing, that no content ends outside the pane, and that the markdown
table keeps its own scroller. Needs `web-bundler/node_modules` (with `replacement_node_modules`
applied to the root `node_modules`) and Playwright/Chromium (`PLAYWRIGHT_MODULE`,
`CHROMIUM_EXECUTABLE_PATH`). Against the unfixed code it reports `scrollWidth` 956 for a 325px
pane and a 236–400px sideways shift after one swipe.
