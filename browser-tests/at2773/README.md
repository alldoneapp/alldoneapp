# AT-2773: Assistant Mode motion

The browser harness renders the shipped scroll/text hooks, AnnaMessageBody,
MessageItemBody, markdown/code/table renderers, React Native Web and Anna CSS.
Backend-dependent tags and action cards are stubbed; no account or paid model call
is needed. AnnaConversation integration (send/retry/draft/history/voice and the
latest-message button) is covered separately by its Jest suite.

Use Node 22 and the existing root/web-bundler dependencies. With Playwright and
Chromium available:

```sh
node browser-tests/at2773/run.js
```

An external Playwright installation can be selected with `PLAYWRIGHT_MODULE`;
`PLAYWRIGHT_BROWSERS_PATH` selects its browser cache. Minimal Linux hosts also
need Chromium's shared libraries and a fontconfig configuration/fonts.

Checks desktop (1280px) and mobile (390px): multiple painted streaming prefixes,
intermediate scroll positions, long responses, scrolling away while streaming,
returning to latest, composer resizing, open/closed code fences, markdown tables,
live reduced-motion preference changes, retained draft and no horizontal overflow.
Mobile additionally uses Chromium's actual touch input to swipe into history.
Screenshots are saved in `screenshots/`; temporary build output is ignored.

```sh
npm test -- --runInBand --watch=false --silent components/Anna \
  components/ChatsView/ChatDV/EditorView/MessageItemBody.test.js \
  components/ChatsView/ChatDV/EditorView/markdownParserFunctions.test.js \
  components/ChatsView/Utils/chatAutoScroll.test.js
```

This is browser emulation, not an iOS/Android device or screen-reader test.
The standard production build exceeded the VM's memory limit during validation;
its completion still needs CI verification.
