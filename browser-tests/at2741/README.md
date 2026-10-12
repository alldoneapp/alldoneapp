# AT-2741: Detail description autosave

Renders the real shared description field, Quill editor, attachment embeds,
file picker and upload helper at desktop (1280px) and mobile (390px) widths.
Description writes and Storage uploads are simulated; this does not write to
production or verify Firebase security rules. Firebase uses the existing
browser harness environment. Apply the repository's dependency replacements
as in CI (`cp -R -f replacement_node_modules/* node_modules/`).

With Node 22, root/web-bundler dependencies and Playwright Chromium installed:

```sh
node browser-tests/at2741/run.js
HARNESS_SCREENSHOTS=1 node browser-tests/at2741/run.js
```

`PLAYWRIGHT_MODULE` and `PLAYWRIGHT_BROWSERS_PATH` can point to installations
outside the checkout. `--skip-build` reuses the previous harness bundle.
The browser needs its usual system libraries and configured fonts.

Checks: no write on mount; Save/OK removed; text autosave; multiline Enter;
image drop and picker upload without further typing; remote URLs persisted;
no repeated upload on subsequent edits; failed writes retain the draft across
editor remount; Retry; and flush on blur. Screenshots show the saved state.

The focused Jest suites also cover upload failures, partial-upload retry,
serialized writes, edits during a save, read-only access, every shared detail
view, backend write acknowledgements and the browser-close warning:

```sh
npm test -- --runInBand --watch=false --runTestsByPath \
  components/TaskDetailedView/Properties/DescriptionField.test.js \
  components/TaskDetailedView/Properties/descriptionAutosave.test.js \
  components/Feeds/Utils/updateNewAttachmentsData.test.js \
  utils/backends/descriptionWriteAck.test.js
```

Run the app with `npm run dev`, open a task, goal, project or skill detail view,
and edit Description. Text saves after a 1-second pause and when leaving the
field; new images/files upload immediately. Failed drafts are kept for retry
across navigation within the current app session, with an unload warning while
unsaved. Crash/reload recovery of local image blobs is outside this change.
