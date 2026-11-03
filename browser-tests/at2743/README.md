# AT-2743: Mobile assistant composer

Renders the production My Day and project assistant composers with real Quill,
auto-expand, attachment/dictation controls, voice/send buttons and German translations.
Account, backend and microphone services use synthetic fixtures; embedded object
renderers have separate component tests.

With Node 22, the repository dependencies and Playwright/Chromium available:

```sh
node browser-tests/at2743/run.js
```

`PLAYWRIGHT_MODULE` can point to an existing Playwright installation. Standard
Playwright variables such as `PLAYWRIGHT_BROWSERS_PATH` are supported. On minimal
Linux hosts, install Chromium's font and shared-library dependencies too. The
harness explicitly fails if the fonts or glyphs cannot render, to prevent false
layout passes.

Both views are checked at 320, 360, 375, 390, 430 and 1440 px. Assertions cover:

- Mobile `Neue Nachricht …` and the existing desktop placeholder.
- Matching 24 px text/placeholder lines, visible placeholder and no control overlap.
- Voice/send controls beside the input, side by side on mobile even with long text.
- The desktop expansion latch, 120 px text cap and no horizontal page overflow.
- Multiple paragraphs, draft preservation across mobile/desktop resize and sending/clearing.

Generated screenshots stay in `.build/` (gitignored).

Component regression tests, including attachment and send behavior:

```sh
npm test -- --runInBand --watch=false \
  components/MyDayView/AssistantLine/assistantInputLayout.test.js \
  components/MyDayView/AssistantLine/AssistantOptions/AssistantOptions.test.js \
  components/MyDayView/AssistantLine/AssistantOptions/AssistantOptionsAttachments.test.js \
  components/TaskListView/OpenTasksView/OpenTaskViewForAssistants/AssistantInputLine.test.js \
  components/TaskListView/OpenTasksView/OpenTaskViewForAssistants/AssistantInputLineAttachments.test.js
```
