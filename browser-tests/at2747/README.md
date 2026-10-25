# AT-2747: Floating note loading spinner

The browser harness renders the real `LoadingData`, animated `Spinner`, Redux
loading reducer and `beginLoadingOperation`. It checks cold-note loading and
the handoff to background sync, delayed visibility, cleanup, pointer events,
and 24px bottom-left geometry on desktop (expanded/collapsed sidebar), 390px
and 320px mobile, anonymous desktop and Anna mode. It uses a fixture surface;
it does not authenticate or open production notes. Jest drives the actual
Quill/Yjs note editor to verify sync, retry, unmount and offline feedback.

With Node 22, root/web-bundler dependencies and Playwright Chromium installed:

```bash
node browser-tests/at2747/run.js
npm test -- --runInBand --watch=false \
    components/UIComponents/LoadingData.test.js \
    components/NotesView/NotesDV/EditorView/NotesEditorViewPerformance.test.js
```

`PLAYWRIGHT_MODULE` and `PLAYWRIGHT_BROWSERS_PATH` may point to an existing
installation. The runner writes screenshots into ignored `.build/`.
Safe-area offsets are also covered by `LoadingData.test.js`. Real-device and
authenticated production checks remain separate from these local checks.
