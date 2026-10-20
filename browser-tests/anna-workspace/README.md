# AT-2745: Stacked assistant VM panels

In assistant mode, choose **VMs** in the top workspace picker. Every session
returned by the existing VM discovery API appears as a full panel in a vertical,
scrollable list. Clicking or focusing a panel selects that run for assistant
context and keeps its result available after completion. Status, project/model,
live activity, approvals, Stop and Open thread use the existing VM components.
Long activity output scrolls within its panel; the list scrolls to later VMs.

Start the application with Node 22 and `npm run dev`.

Run the focused checks:

```bash
npm test -- --runInBand --watch=false \
    components/Anna/AnnaShell.test.js \
    components/Anna/AnnaVmWorkspace.test.js \
    components/Anna/useAnnaVmJobs.test.js \
    components/ChatsView/ChatDV/EditorView/StopAssistantRunButton.test.js
VM_ONLY=1 node browser-tests/anna-workspace/run.js
```

The browser harness needs root and `web-bundler` dependencies plus Playwright
and Chromium. If installed separately, set `PLAYWRIGHT_MODULE` to the Playwright
module path and `CHROMIUM_EXECUTABLE_PATH` to the browser executable. Builds and
generated screenshots stay in the ignored `.build/` directory.

The harness uses fixture data with real assistant shell, VM panels, approvals
and Stop components. It checks simultaneous live updates, panel selection,
thread links, approval feedback drafts across panel/browser switches, selected
completed results, Stop routing to the correct run, vertical stacking and
scrolling without horizontal overflow at 1440, 1024, 390 and 320 pixels.

Review screenshots: [desktop](../../docs/screenshots/AT-2745-desktop-vms.png)
and [mobile](../../docs/screenshots/AT-2745-mobile-vms.png).

For AT-2754, assistant layout preferences also survive desktop and installed macOS
PWA cold launches. The existing local preference stores only `split`, `chat`, or
`alldone`; launch restoration happens before React mounts. Explicit layout URLs
take precedence, and resource/auth/share links keep their incoming layout. The
existing mobile preference key is retained so no migration is needed.

```bash
npm test -- --runInBand --watch=false utils/annaMode.test.js \
    components/Anna/AnnaShell.test.js URLSystem/Tasks/URLsTasksHistory.test.js
LAUNCH_LAYOUT_ONLY=1 node browser-tests/anna-workspace/run.js
```

The browser check opens fresh documents at the PWA manifest start URL, verifies
all three layouts and the pane controls at 1440, 1024, 390 and 320 pixels, and
checks for runtime errors. On macOS, also verify the installed app by selecting a
layout, quitting it, and reopening it from the Dock. Preferences are local to the
installation's browser storage and cannot survive clearing or blocking storage.

For AT-2776, **every activation** of assistant mode on desktop and mobile
reveals the latest message, regardless of the previous reading position. The
shared top-bar/sidebar action focuses the composer within the gesture. Mode
activation through zoom, URL/history restoration, and async conversation mounting
also resets the bottom-follow state. Workspace and chat drafts stay mounted.
Viewport and content resizing (including late images/attachments) keep following
the end until the user deliberately scrolls away. Reopening always resets that choice.

```bash
npm test -- --runInBand --watch=false components/Anna/AnnaShell.test.js \
    components/Anna/AnnaConversation.test.js components/Anna/AnnaChatComposer.test.js \
    components/TopBar/AssistantModeButton.test.js utils/annaMode.test.js
ASSISTANT_FOCUS_ONLY=1 node browser-tests/anna-workspace/run.js
```

The browser check uses real shell/buttons/Quill with fixture transport, touch taps
at 390/320 pixels and mouse clicks at 1440/1024 pixels. It checks focus before the
opening action returns, first cached opening, repeated deactivate/reactivate,
hidden mobile chat, global mode activation, late content growth, viewport resizing,
and retained drafts. It also checks uncached six-second async loading both with
chat focus retained and after editing in the workspace. Generated screenshots stay
in `.build/`. Review the [mobile example](../../docs/screenshots/AT-2776-mobile-assistant-focus.png).

On an iPhone, verify top-bar and sidebar opening after scrolling to older messages:
the latest message should be visible and the keyboard should appear. Repeat from
the mobile workspace, with an unsent draft, and during a voice call. Headless tests
do not verify a physical software keyboard. With no cached conversation, the input
does not exist until the network responds: scrolling still runs after loading;
focus is handed over only while the chat still owns focus. iOS may require a
second tap to show its keyboard. The fix renders synchronously for explicit
opening; see [React's flushSync API](https://react.dev/reference/react-dom/flushSync)
and [WebKit's user-gesture requirement](https://bugs.webkit.org/show_bug.cgi?id=195884).
