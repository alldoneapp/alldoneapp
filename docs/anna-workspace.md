# Anna workspace

The assistant-line zoom button switches layout in place. The same Alldone route remains mounted inside `AnnaShell`; the chat composer stays mounted after its first opening. Desktop uses a resizable split, and mobile switches between Chat and Workspace. Returning to fullscreen does not cancel work.

The default project's default assistant answers in daily `AnnaChat<local-date><user-id>` topic chats. The backend calculates midnight from the existing user timezone rules. An owner-only registry joins these into one history, including the previous permanent Anna conversation. New chats follow WhatsApp's project sharing rules; legacy private chats keep their visibility. App and WhatsApp transcripts remain separate, with the existing common user memory. Recent prior-day summaries/messages provide continuity. Old days and messages load on demand.

While assistant mode is open, the conversation also shows local, timestamped notices for new followed (red) feed entries and chat messages. Their links open the project's followed Updates or Chats list inside the workspace. The existing unread subscriptions supply these notices; displaying a notice does not mark its source read or invoke the assistant. Existing unread activity on entry is baselined, reconnects are deduplicated by entry/message ID, and the latest 100 activity notices are retained for this mounted conversation view. Archived/template projects, own feed entries, and chats already shown in the conversation or active chat are excluded. The badge after the assistant name uses Home's shared open-task count and `AmountTag` styling.

Substantial delegated work uses ordinary assistant-assigned tasks. Progress, questions, and deliverables belong in task comments or linked notes. VM work creates a task only when it does not already have one, and sends a concise result link back to the originating conversation. Completion uses the existing task tools when the outcome is achieved; launching or finishing an individual VM attempt does not automatically close the whole task. Heartbeat scheduling and delivery are unchanged.

Taking Alldone control defers assistant navigation and blocks relevant native write tools. Taking browser control prevents the next assistant gesture and waits for an in-flight gesture to finish. Explicit hand-back releases control; a blocked text request gets a visible continuation message through the existing chat execution path. Voice keeps its current call and can continue using the released surface.

The Browser pane displays the existing browser worker's actual viewport, refreshed every five seconds while foreground and visible. It is a sequence of screenshots, not a VM desktop video stream. Human clicks, typing, keys, and scrolling use that same authenticated session. Screenshots and typed values are not persisted by the pane. Existing policy, session limits, and billing apply to actions; merely watching does not cost browser-step Gold. Browser ownership and project membership are checked on the server.

For delegated VM browsing, the assistant uses the shared Alldone browser tools through MCP, with the real `taskId` on every browser call. Task access is validated before binding the session. This lets Anna resume the same browser from the continuous conversation. General VM terminal execution continues to be represented by its ordinary task and comments.

## Verification

- Web component tests: `npm test -- --runInBand --watch=false components/Anna components/MyDayView/AssistantLine/AssistantLine.test.js components/UIComponents/LoadingData.test.js components/RootView/MainViewsContainer.test.js utils/responsiveLayout.test.js i18n/translationKeyCoverage.test.js`
- Functions tests: `TZ=UTC node node_modules/jest/bin/jest.js --config ci/jest.functions.config.js --runInBand functions/Assistant/annaWorkspace.test.js functions/Assistant/annaHighlight.test.js functions/Assistant/assistantHelper.test.js functions/Assistant/toolSchemas.test.js functions/Assistant/browser functions/WhatsApp/assistantLiveBackend.test.js`
- Browser layout harness: `node browser-tests/anna-workspace/run.js`. Requires Playwright and Chromium; set `BROWSER_CHANNEL=chrome` to use installed Chrome. Uses real shell/chat components with synthetic transport and an editable workspace fixture, without a production account. Covers 1440, 1024, and 390 pixel widths, editor identity/drafts, mobile visibility, overflow, and runtime errors. Output is ignored under `.build/`.
- Activity notices and badge: `ACTIVITY_ONLY=1 node browser-tests/anna-workspace/run.js` checks live arrivals, navigation and header geometry at 1440, 1024, 390 and 320 pixels.
- Note editor width: `NOTE_WIDTH_ONLY=1 node browser-tests/anna-workspace/run.js` uses the real Quill editor and note stylesheet at 1440, 1024, 390 and 320 pixels. Checks body/toolbar/placeholder width, pane resizing and retained drafts while switching layouts. Notes use the available page width in both assistant mode and normal Alldone, preserving outer page padding.
- Production bundle: `npm run build-web-webpack`.

## Deployment

Deploy the updated Functions (including `annaBrowserWorkspaceSecondGen` and `getAnnaConversationSecondGen`) before the web bundle. Production uses the master pipeline. For staging QA from a current feature branch, run the manual `deploy:cloud:functions:staging` and `deploy:cloud:runner:staging` jobs, then `deploy:web-staging-live`. The old develop branch does not need to advance. Functions jobs validate the CI environment JSON before deployment.

Both environments have a separate IAM-private `browser-worker` Cloud Run service in europe-west1. Build or update it with `functions/Assistant/browser-worker/deploy.sh`; the ordinary Functions pipeline does not deploy this service. Keep the worker signing secret equal to the corresponding GitLab `GOOGLE_FUNCTIONS_ENV_DEV` or `GOOGLE_FUNCTIONS_ENV_PROD` value and grant only the existing Firebase Admin SDK caller `roles/run.invoker` on the worker. Runtime configuration must be persisted in the CI variable so the next deploy preserves it.

Enable `browser_automation` in the intended assistant's Tools Access and configure that project's allowed websites. Existing project policies and assistant permissions remain authoritative; deploying the infrastructure does not enable every assistant. No heartbeat or saved-work migration is required.

For a live check, ask the default assistant to open a public page using the shared browser. Verify the right pane displays its viewport, take control and interact, then request another page while holding control. The assistant must pause and resume the blocked request after explicit hand-back. Check the ordinary Alldone surface still works after zooming back in.
