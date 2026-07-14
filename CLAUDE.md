# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Alldone is a React Native/Firebase productivity platform supporting tasks, goals, notes, contacts, and real-time collaboration. Runs on iOS, Android, and web with shared codebase.

## Development Commands

```bash
# Development
npm start                    # Start Metro bundler
npm run web                  # Start web version (Expo)
npm run android              # Run on Android
npm run ios                  # Run on iOS
npm run start-clean          # Start with cache reset

# Firebase Functions (local)
firebase emulators:start --only functions --inspect-functions

# Testing
npm test                     # Run Jest tests
npm test -- --testPathPattern="TaskList"  # Run single test file
npm run coverage             # Generate test coverage
npm run update-snapshots     # Update Jest snapshots

# Build & Deploy
npm run build-web            # Build for web production
npm run format-code          # Format with Prettier
```

**Required versions**: Node 14.21.3, npm 6.14.18, expo-cli 6.1.0, firebase-tools 13.29.3

**Cloudflare worker exception**: The repo stays on Node 14.21.3 for the main app and Firebase work, but `cloudflare/email-worker/` uses Node 20 for Wrangler. That directory has its own `.nvmrc`; use `nvm use 20` inside `cloudflare/email-worker/`, then switch back to `nvm use 14` at the repo root for normal app work.

## Architecture Overview

### Directory Structure

-   `components/` - Feature-based UI (TaskListView/, GoalsView/, NotesView/, ContactsView/, etc.)
-   `utils/backends/` - Firebase abstraction layer (firestore.js, openTasks.js, doneTasks.js)
-   `utils/BackendBridge.js` - Central Firebase operations facade
-   `URLSystem/` - Custom routing with per-feature triggers and constants
-   `redux/` - State management (actions.js, store.js)
-   `functions/` - Firebase Cloud Functions (v2 syntax)
-   `i18n/translations/` - Localization (en.json, de.json, es.json)

### Key Patterns

**Backend Bridge**: `utils/BackendBridge.js` abstracts all Firebase operations. Feature-specific backends in `utils/backends/` (Tasks/, Goals/, Notes/, etc.).

**URL System**: `URLSystem/URLSystemTrigger.js` handles navigation. Each feature has its own trigger file (e.g., `URLSystem/Tasks/`).

**DetailedView Pattern**: Entity screens follow `[Entity]DetailedView` naming (TaskDetailedView, GoalDetailedView, ContactDetailedView).

**Real-time Collaboration**: Quill editor + Yjs for notes. Custom Quill modifications require replacing `node_modules/quill/dist/quill.js` with `replacement_node_modules/quill/dist/quill.js` after npm install.

**Yjs Text Formatting**: When inserting text with `ytext.insert()`, passing `undefined` for attributes causes attribute inheritance from adjacent text. Always explicitly set formatting attributes to `null` to clear them (e.g., `{ bold: segment.bold ? true : null }`). This applies to markdown-to-Yjs conversion in `functions/Assistant/markdownToYjs.js`.

**Yjs applyDelta() Format Removal Bug**: Yjs's `applyDelta()` doesn't properly handle `null` attributes for format removal (see [GitHub Issue #474](https://github.com/yjs/yjs/issues/474)). When Quill sends `{retain: N, attributes: {bold: null}}` to remove formatting, `applyDelta()` doesn't reliably remove the attribute. The fix in `replacement_node_modules/y-quill/src/y-quill.js` intercepts these operations and uses `type.format(index, length, {bold: null})` instead, which properly removes formatting. **Critical**: The `applyDelta()` and `type.format()` calls MUST be wrapped in a single `doc.transact()` to ensure atomicity. Without this, the insert (which may inherit attributes from adjacent formatted text) and the format fix are separate Yjs transactions — if the document is synced/persisted between them (app close, network interruption), the format fix is lost and attributes "bleed" on reload.

**Background Color "None" Handling**: The highlight color picker's "None" option must call `editor.format('background', false)` (not `editor.format('background', '#FFFFFF')`). Setting to white (`#FFFFFF`) leaves an explicit `background` attribute in Yjs that causes format inheritance when typing adjacent to previously-highlighted text. Using `false` generates `{background: null}` in the delta, which properly removes the attribute from Yjs via the `type.format()` fix above.

### State Management

Redux store in `redux/store.js` (~116k lines) with actions in `redux/actions.js` (~63k lines). Uses `@manaflair/redux-batch` for batched updates.

### Firebase Functions

Located in `functions/`. Uses Firebase Functions v2 syntax:

-   `onDocumentCreated`, `onDocumentUpdated`, `onDocumentDeleted` for Firestore triggers
-   `onSchedule` for scheduled functions
-   `onCall`, `onRequest` for HTTP functions

**Important**: Cloud Functions cannot import non-cloud function modules directly. Keep function code self-contained or use shared helpers within `functions/`.

## Development Guidelines

### Localization

Always consider i18n. Translations in `i18n/translations/` (en.json, de.json, es.json). Use TranslationService for new strings.

### Assistant Tool Checklist

When adding a new assistant tool, wire every layer, not just the backend schema:

-   Define the schema in `functions/Assistant/toolSchemas.js` and add/adjust `functions/Assistant/toolSchemas.test.js`.
-   Implement native execution in `functions/Assistant/assistantHelper.js`, including permission/runtime-context checks, conversation-safe results, and focused tests in `functions/Assistant/assistantHelper.test.js`.
-   Add the tool to the assistant settings UI in `components/AssistantDetailedView/Customizations/ToolsAccess/toolOptions.js` so it can be enabled per assistant. Decide deliberately whether it belongs in `DEFAULT_ALLOWED_TOOLS` or `OPT_IN_ONLY_TOOLS`, then cover that in `toolOptions.test.js`.
-   Add local strings for the tool label in `i18n/translations/en.json`, `de.json`, and `es.json`.
-   Check channel-specific allowlists before assuming the tool is available everywhere. Gmail labeling follow-up uses the normal assistant `allowedTools`, while email replies and realtime/WhatsApp flows may have separate safe-tool filters or schema adapters.
-   If prompts mention the tool, ensure the responsible assistant can actually enable it in Tools Access; otherwise the prompt can ask for an action the runtime will block.

### Modals and Popups

Handle event propagation carefully. Set proper z-index and container `<div>` elements.

**Chat message edit dismiss race**: In `components/ChatsView/ChatDV/EditorView/MessageItem.js`, opening the per-message edit `DismissibleItem` directly from the timestamp/pencil click can mount `react-dismissible` early enough that the same click is interpreted as an outside-dismiss click. Symptoms: the edit handler fires, `openModal()` runs, `onToggleModal(true)` is immediately followed by `onToggleModal(false)`, and nothing appears on screen. Defer the `openModal(true)` call with `setTimeout(..., 0)` after dispatching `setActiveChatMessageId(message.id)`, and clear the timeout on unmount. If diagnosing this path, use scoped logs around `MessageItemHeader` click handling, `enableEditMode`, and `MessageItemContent`'s `onToggleModal`.

**Popover Width Control**: Most modals use `applyPopoverWidth()` from `utils/HelperFunctions.js` which applies fixed widths based on screen size (mobile/tablet/desktop). This helper overrides inline styles due to how it's applied via `style={[localStyles.container, applyPopoverWidth()]}`. To create larger modals that use more screen width, avoid `applyPopoverWidth()` and calculate width dynamically using `Dimensions.get('window').width`.

**React Native Dimensions Compatibility**: Do not use `useWindowDimensions()` in this codebase. The current React Native/web setup does not provide it reliably and it causes runtime failures such as `TypeError: useWindowDimensions is not a function`. Use `Dimensions.get('window')` instead when sizing responsive modals or panels.

**Popover Positioning and Viewport Safety**: Popovers using `react-tiny-popover` position content relative to the trigger element by default. Do not override `contentLocation` unless there is a clear reason and the behavior has been checked at narrow and short viewport sizes. The known-good task reminder/postpone date pattern is in `components/UIControls/DueDateButton.js` + `components/UIComponents/FloatModals/DueDateModal/DueDateModal.js`: keep desktop positioning library-managed with `contentLocation={smallScreen ? null : undefined}`, and make the modal itself fit the viewport with `applyPopoverWidth()`, `maxHeight: windowSize[1] - MODAL_MAX_HEIGHT_GAP`, and an internal `CustomScrollView`. For global centered popups such as `DueDateSinglePopup`, use a centered overlay wrapper and only center the popover on small-screen navigation (`contentLocation={smallScreenNavigation ? null : undefined}`). Avoid custom coordinate functions for large modals; they can render the `.react-tiny-popover-container` off-screen or invisibly. Fix size issues in the modal content instead: cap width/height to the available viewport, remove fixed minimums that exceed small screens, and scroll inside the modal.

**Nested `react-tiny-popover` dismisses its parent on tap (mobile tap/click timing)**: `react-tiny-popover` (v4) closes a popover by attaching a `window` `'click'` listener and calling `onClickOutside` whenever the click target is not inside **that** popover's own `document.body` portal. A nested popover (a dropdown/picker opened from inside a popover-based modal) renders in a **separate** portal, so tapping an item in the child is "outside" the parent — the parent's `onClickOutside` fires and the whole modal closes. This reproduces mainly on **mobile web**: a tap emits the touch press (`onPress`, which does the selection) and then a **synthesized `click` shortly after**, and it is that trailing click that reaches the parent's window listener — on desktop the RN-web press typically stops the click from bubbling to `window`, hiding the bug. The ordering is dependable: `onPress` (pointerup/touchend, or the click at the event target during bubbling) always runs before the trailing `click` reaches `window`, so a flag set in `onPress` is readable by the parent's `onClickOutside`. Fix (see `components/TaskListView/EmailLine/EmailLabelChip.js` + `EmailLabelModal/EmailRow.js` + `emailLineHelper.js`): on the child item's `onPress`, stamp a module-level interaction (`markEmailLabelPickerInteraction`); in the parent's `onClickOutside`, swallow the dismiss **once** (`shouldIgnoreEmailLabelModalDismiss` clears the stamp and returns true). Prefer this **consume-once** guard over a fixed time window so it does not depend on how far apart the tap and click land; keep a generous sanity cap (~2s) so a stamp whose dismiss never arrives (the desktop case) can't later swallow a genuine outside tap. Do not reach for `contentDestination` to re-parent the child into the modal DOM — it breaks the library's viewport-relative positioning math — and avoid an in-flow inline dropdown (it expands the modal) or an absolute in-modal overlay (it gets clipped by the modal's `CustomScrollView`).

### Gold Transactions

-   Every gold change (earn, spend, refund, adjustment) must go through `applyGoldChange` / `deductGold` / `refundGold` / `adjustGold` in `functions/Gold/goldHelper.js` so it lands in the user's `goldTransactions` subcollection. Never mutate `users/{uid}.gold` directly — the log is how users see what happened in the Gold history modal.
-   When adding a new gold spend or refund, always pass a descriptive `source` (a new machine key, e.g. `meeting_transcription`, `gmail_labeling`) plus as much linking context as you have: `projectId`, `goalId`, `objectId`, `objectType`, `channel`, and an optional human `note`. The sanitized fields are defined in `functions/Gold/goldTransactions.js` — add new fields there if you need more link context.
-   Add a human label for every new `source` in `components/SettingsView/Profile/Properties/GoldTransactionsModal.js` (`getTransactionLabel`) and a matching translation key in `i18n/translations/en.json`, `de.json`, and `es.json`. The modal falls back to `Gold transaction` if the source is unknown.
-   Prefer storing enough context that the transaction can deep-link back to its source (chat/topic, goal, contact, Gmail message, etc.). The modal's `getTransactionLink` builds the URL from `projectId` + `objectId` + `objectType` / `channel`; extend it when adding a new source type that has a natural destination.

#### Gold analytics & rollups (tracking earn/spend over time)

-   **GA4 events (consent-gated)**: `goldHelper.js` calls `logGoldAnalytics` → `GAnalytics.logEvent` for every change. `normalizeServerEvent` in `functions/GAnalytics/GAnalytics.js` maps each ledger direction to its **own** GA4 event so they don't pollute each other: `earn_gold`→`earn_virtual_currency`, `spend_gold`→`spend_virtual_currency`, `refund_gold`→`refund_virtual_currency`, `adjust_gold`→`adjust_virtual_currency` (all with `virtual_currency_name: 'gold'`, `value`, `source`). `adjustGold` passes the **signed** delta so admin deductions report a negative `value`. These only fire for users with `analytics.consent === 'granted'`, so GA **undercounts** — use it for trends, not exact totals.
-   **Firestore rollups (consent-independent, exact)**: the `aggregateGoldTransactionStats` trigger (`functions/Gold/goldStatsAggregator.js`, registered on `users/{userId}/goldTransactions/{transactionId}` in `index.js`) increments `goldStats/daily/days/{YYYY-MM-DD}` and `goldStats/monthly/months/{YYYY-MM}` (UTC buckets). Each doc holds gross `earn`/`spend`/`refund` + signed `adjust`, per-direction counts, a signed `net`, and `spendBySource`/`earnBySource`/`refundBySource` maps (spend-by-source = feature usage). Idempotent via an `aggregatedAt` stamp on the source ledger doc (guards against at-least-once duplicate trigger delivery; an `update` doesn't re-fire `onDocumentCreated`). `goldStats` is admin-read / server-write only (`firestore.rules`).
-   **Deploy steps**: deploy the function + `firebase deploy --only firestore:rules`, then backfill existing history with `node migration/backfillGoldStats.js --firebase-project-id=<project>` (dry run; add `--execute` to apply, `--user-id=<uid>` to scope). The backfill reuses the same per-transaction idempotent path, so it is safe to run with the trigger already live. No Cloud Tasks / IAM grants are needed.

### Gmail Follow-Up Tasks

-   Gmail follow-up tasks created from labeling prompts use `task.gmailData.origin === 'gmail_label_follow_up'`.
-   These tasks must stay in the normal task list, not the dedicated Gmail/email task bucket. Only inbox-summary Gmail tasks should be treated as email tasks.
-   Do not rewrite or sanitize the task title text for Gmail follow-up tasks. If the assistant-created title contains a Gmail link, leave it as-is.
-   In the task list row, the Gmail affordance should be rendered as an inline left tag/chip using `SocialText`'s `leftCustomElement`, not as an absolutely-positioned icon. This keeps wrapping correct so continuation lines align under the chip instead of under the first text token after it.
-   Opening a Gmail follow-up task from the chip should target the specific Gmail message and should prefer an account-aware URL flow. Current helpers live in `utils/Gmail/gmailTaskUtils.js` and `functions/Gmail/serverSideGmailLabelingSync.js`.

### IAM for firebase-admin GCP calls — use the Firebase Admin SDK SA, not the compute SA

This is a repo-wide gotcha, learned the hard way. `functions/firebaseConfig.js` initializes admin with `admin.credential.cert(serviceAccountKey.json)` (in CI, `serv_account_key_<env>.json` is copied to `serviceAccountKey.json` by `service_accounts/setup_functions.sh`). Because of that explicit cert credential, **every firebase-admin call that hits a Google Cloud API authenticates as the `firebase-adminsdk-*@<project>.iam.gserviceaccount.com` service account — NOT the Cloud Run / `<projectNumber>-compute@developer.gserviceaccount.com` runtime SA** that `gcloud run services describe` reports. So when a function needs a new GCP IAM permission (Cloud Tasks, Pub/Sub, etc.), grant the role to the **firebase-adminsdk SA**. Granting the compute SA looks right but does nothing (cost us ~an hour of "still denied" past propagation). IAM changes also take up to ~7 min to propagate — wait before re-testing.

### Assistant VM Tool (`execute_task_in_vm`) & Cloud Tasks worker

VM agent templates and CLI updates: the runner always uses E2B's managed `claude` / `codex` prebuilt templates. Before every invocation, including resumed sessions, it installs the latest matching CLI into `/home/user/.local` and prepends that bin directory to `PATH`; custom E2B template overrides are intentionally ignored.

-   The tool hands long-running, open-ended work to a Claude Code agent in an ephemeral **E2B** sandbox and posts the result back into the chat. Flow: `assistantHelper.js` dispatch → `functions/Assistant/vmJob.js` (`startVmJob`: validate, gold charge, write `pendingWebhooks` + `vmJobs` docs, post status comment, enqueue) → `runVmJob` (`onTaskDispatched` in `index.js`) → `functions/Assistant/vmJobRunner.js` (E2B sandbox + headless `claude -p`, streams progress, posts result, refunds gold on failure). Reuses the existing `pendingWebhooks` async-job collection.
-   It is **enabled by default** — it is part of `DEFAULT_ALLOWED_TOOLS` (`toolOptions.js`), so a new assistant can spend Gold on a VM run without the owner opting in. It was opt-in originally; commit `f9a1e20b0` ("Enable VM tasks by default") moved it into the default set. It can still be switched off per assistant in the Tools Access UI. Only `mcp_servers` is currently in `OPT_IN_ONLY_TOOLS`.
-   **Host thread (auto-create when contextless)**: a VM job must be anchored to a task/topic thread — the worker posts the status comment + live progress + result there, bills Gold against it, and keys the resumable VM session by `${projectId}__${objectId}`. When `execute_task_in_vm` is invoked from within a conversation it uses that thread. When it's invoked **outside** any conversation (a contextless assistant trigger with no `objectId`), the dispatcher (`executeToolNatively` → `ensureVmJobThread` in `assistantHelper.js`) creates a **fresh task** in the assistant's project (reusing `create_task`'s `resolveCreateTaskTargetProject` + `TaskService.createAndPersistTask`) to host the job. Each contextless call gets its own task/thread — and therefore its own (cold) VM session; the work is continued later by talking to the assistant inside that created task, which then resumes normally. The per-user concurrency cap is pre-checked in the dispatcher before the host task is created (so a capped user gets no stray empty task); `startVmJob` re-checks it as the authoritative gate. The `!projectId || !objectId` guard in `startVmJob` is now a defensive fallback rather than the primary path.
-   **Following + visibility of the auto-created task**: `ensureVmJobThread` calls `ensureChatExists` (exported from `assistantStatusHelper.js`) right after persisting the task to create its chat object with the requesting user in `usersFollowing`/`followerIds`, `stickyData.days=0`, and `isPublicFor=[FEED_PUBLIC_FOR_ALL, creatorId]`. This guarantees following — so the user gets in-app + push + email chat notifications when the VM posts its result, and the task appears in their chat list — instead of relying on the later best-effort status-comment write (`createInitialStatusMessage`) to be the first chat-object writer. The `isPublicFor` is set public-for-all so the chat matches the task doc's visibility (the task is created with `isPrivate:false`, so `createTaskObject` already sets `isPublicFor=[FEED_PUBLIC_FOR_ALL, userId]`) — both the task and its chat are visible to all project members. The worker's completion path notifies `userIdsToNotify` (always includes the requester) for in-app notifications and `getObjectFollowersIds` (= `usersFollowing`) for push/email (`vmJobRunner.js` `applyVmCompletionMetadata`).
-   **Context for the auto-created task** (`vmHostTaskHelper.js`): a fresh task has no thread conversation for `buildVmThreadContext` to read, so `ensureVmJobThread` posts the **full prompt as the task's first chat entry** (the title from `buildVmJobTaskName` is necessarily abbreviated, and the description is left empty). `postVmHostTaskRequestComment` writes a user-authored comment (`fromAssistant: false`, `STAYWARD_COMMENT`) whose text is `buildVmJobTaskDescription` (objective + `**Deliverable:**` + `**Original request:**`, the request line omitted when it equals the objective) with any attached images embedded as image tokens (`mergeTaskDescriptionWithImages`) and set on `mediaContext`. Because it's a real comment, the user reads exactly what the VM was asked, and the VM agent is grounded through `buildVmThreadContext`'s normal conversation/attachment slices — i.e. the contextless job now behaves like a normal in-thread one (no special `originatingRequest` path). Everything else in the bundle (user/project descriptions, user memory, assistant persona, date/time, language) resolves from docs and works for a brand-new task unchanged.
-   **Result delivery across channels (incl. delegation)**: a settled VM job (completed/failed/cancelled/gold-exhausted) always posts its result into the host task thread, but it also fans out to the channels the request actually came through via `notifyVmResultChannels` (`vmJobRunner.js`): (1) **WhatsApp** — when the job is WhatsApp-triggered (`triggerChannel === 'whatsapp'` + `whatsappTo`), `sendWhatsAppVmResultNotification` texts the result + a deep link back via Twilio; (2) **origin conversation** — when the job was delegated from another thread, `postVmOriginConversationNote` posts a short completion note (authored by the origin assistant, with a link to the host task) back into the conversation the user is actually in. The hard part is the **delegation chain** (WhatsApp → Anna → `talk_to_assistant` → CTO in project X → `execute_task_in_vm`): `executeDelegatedAssistantRequest` used to build a delegated runtime context with only `projectId`/`assistantId`/`requestUserId`, dropping the channel — so the VM had no way to notify the WhatsApp user. It now forwards `sourceChannel` + `whatsappFromNumber` (so the WhatsApp completion text fires) and the **origin conversation** (`originProjectId`/`originObjectType`/`originObjectId`/`originAssistantId`, persisted on the job by `startVmJob` only when distinct from the host thread) plus `language`/`userTimezoneOffset`. It deliberately does **not** forward `objectType`/`objectId`, so the delegate still hosts the job in its own fresh task (the contextless path) rather than the caller's thread. The requester also follows the host task (in-app/push/email) as the in-app fallback.
-   **Agent choice**: the tool takes optional `agent` (`claude` | `codex`) and `agentReasoningEffort` (`low` | `medium` | `high` | `xhigh`) params. Resolution happens once in `startVmJob`: an explicit tool argument wins, otherwise `users/{uid}.defaultVmAgent` / `defaultVmAgentReasoningEffort` is used. Legacy users without preferences keep the system agent default (`claude`) and provider effort defaults (Claude → `high`, Codex → `medium`). Settings → Integrations persists the validated preferences through `getVmAgentSettings`, `setDefaultVmAgent`, and `setDefaultVmAgentReasoningEffort`; setting the effort to `null` removes it. You can additionally pass `agentModel` (defaults: Claude → `opus` alias, Codex → `gpt-5.6-sol`). The minimum effort is `low`; legacy Codex `minimal` requests are still clamped to `low` because current Codex Responses requests may include tools that OpenAI rejects with minimal effort. Claude uses `--effort`; Codex uses `model_reasoning_effort`. The resolved model + effort are surfaced to the user in the VM status comment — both the initial "Spinning up …" message (`vmJob.js`) and the live "Working with … in a VM" header (`vmJobRunner.js`) render a `(<model> · <effort> effort)` suffix via the shared `formatAgentRunSuffix` / `resolveAgentRunDetails` helpers. `vmJobRunner.js`'s `AGENT_CONFIGS` maps the agent to the matching **E2B-managed prebuilt template** (`claude`/`codex`), credentials, headless command (`claude -p … --model <id> --effort <level> --output-format stream-json` vs `codex exec --model <id> -c model_reasoning_effort=medium --json`), and a per-agent JSON-stream parser that drives the live activity feed in the chat. Before each invocation the runner installs the latest agent CLI into `/home/user/.local`, including on resumed sandboxes. Custom E2B template overrides are ignored.
-   **Optional personal subscription auth**: Settings → Integrations lets a user connect Claude (`claude setup-token` → `CLAUDE_CODE_OAUTH_TOKEN`) or Codex (`codex login` with `cli_auth_credentials_store = "file"`, then paste `~/.codex/auth.json`). Credentials live in `users/{uid}/private/vmAgentSubscriptions`; callable responses expose status only, never the secret. The job records whether subscription or Alldone API billing was selected and says so in both initial and live VM status text. API-billed runs use `vmLlmProxy` so platform API keys never enter the sandbox. Subscription runs bypass the proxy: Claude receives the OAuth token only in the process environment; Codex receives a mode-600 auth cache in `/home/user/.codex/auth.json`. The worker persists a refreshed Codex cache and removes it before pausing the reusable sandbox.
-   **Persistent per-thread session (resume)**: each chat thread keeps one VM session. After a run the worker **pauses** the sandbox (snapshotting filesystem + the agent's session store) and records its id on `vmSessions/{projectId}__{objectId}`; the next `execute_task_in_vm` in that thread **resumes** it (`Sandbox.connect`) and runs the agent with `--continue` (Claude) / `codex exec resume --last` so it keeps prior files + conversation. `e2b@1.x` has no `pause()` — we POST the pause REST endpoint (`api.e2b.dev/sandboxes/{id}/pause`, `X-API-KEY`) directly; resume is `Sandbox.connect`, cleanup is `Sandbox.kill`. After a run the sandbox is **kept running for a ~10-min keep-alive window** (so back-to-back tasks in a thread hit a live VM with no resume latency); the `pauseIdleVmSessions` schedule (every 2 min) pauses sessions idle past that window, and `cleanupIdleVmSessions` deletes them after 7 days. The sandbox self-kill timeout (15 min) sits above the grace window + pauser interval so the pauser always pauses (preserving state) before E2B would kill the idle VM. `collectArtifacts` filters by `modifiedTime` so a resume only re-attaches files written in that run. Caveat: persistence is an E2B beta — validate across multiple resumes ([E2B #884](https://github.com/e2b-dev/E2B/issues/884)).
-   **File/artifact return**: the agent is told to save deliverable files to `/home/user/output/` only when the user requested a file or the work genuinely produces an artifact; normal chat answers should stay in the final message with no generated output file. Before tearing down the sandbox, the worker pulls those files out (`sandbox.files.list/read`), uploads them to Firebase Storage at `attachments/{commentId}/{file}` (with a `firebaseStorageDownloadTokens` metadata token), and attaches them to the result comment. **Inline downloadable rendering requires embedding an attachment token in the comment text** — `${ATTACHMENT_TRIGGER}{url}${ATTACHMENT_TRIGGER}{name}${ATTACHMENT_TRIGGER}false` (trigger `EbDsQTD14ahtSR5`, see `components/Feeds/Utils/HelperFunctions.js`), which the chat parses into a `FileDownloadableTag`. The `mediaContext` array alone does NOT render an inline download, and a bare filename in the text gets auto-linkified to a bogus URL by `REGEX_URL`, so always use the token. We also store `mediaContext` for the assistant read-side. Caps: 10 files, 20 MB/file, 40 MB total. Uses the existing `roles/storage.admin` on the firebase-adminsdk SA.
-   **Gold pricing is hybrid + metered** (`VM_JOB_BASE_GOLD` + `VM_GOLD_PER_MINUTE` + `VM_TOKENS_PER_GOLD` in `vmJob.js`): 20 Gold is charged up-front in `startVmJob` (refunded on failure), then the worker charges 10 Gold per started execution minute plus `round(totalTokens / tokensPerGold)` on completion. Tokens come from the agent's actual reported `usage` (Claude `result` event incl. `total_cost_usd`; Codex `turn.completed`), captured in the stream parser and stored on the `vmJobs` doc. When a personal Claude/Codex subscription is used, `tokenGoldTotal` is forced to zero; the 20 Gold base + 10 Gold per started VM minute still applies. API-billed token usage matches in-app assistant usage (100 tokens/Gold).
-   **Cloud Tasks IAM (three grants, NOT auto-configured by `firebase deploy`)** — all on the firebase-adminsdk SA (see gotcha above): (1) `roles/cloudtasks.enqueuer` at the **project level** (queue-scoped was observed not to be honored for firebase-admin's `enqueue()`), (2) `roles/iam.serviceAccountUser` on the SA itself (`actAs`, to mint the task's OIDC token), and (3) `roles/run.invoker` on the **`runvmjob`** Cloud Run service (gen2 lowercases the function name) so Cloud Tasks can invoke the worker. The denials surface one at a time as you fix them (`cloudtasks.tasks.create` → `iam.serviceAccounts.actAs` → `run.invoker`). Run `functions/e2b-template/grant-enqueuer.sh <projectId>` once per environment after deploy; it auto-detects the SA and applies all three.
-   **E2B SDK is pinned to `e2b@^1.x`** in `functions/package.json` — v2 cannot load under the Node 20 CommonJS functions runtime (`ERR_REQUIRE_ESM` from its CJS bundle; `Dynamic require of node:url` from its ESM bundle under raw `node`). The Docker-free v2 **template build** tooling lives isolated in `functions/e2b-template/` (its own ESM package, run via `tsx`) and is excluded from the functions deploy via `firebase.json` `functions.ignore`.
-   **Templates and CLI versions**: the worker always starts from E2B's managed `claude` or `codex` template and installs the matching `@latest` CLI into `/home/user/.local` immediately before the agent command. The legacy `functions/e2b-template` builder remains in the repository for reference but is not selected by the runner.
-   Secrets `E2B_API_KEY`, `ANTHROPIC_API_KEY`, `VM_PROXY_SIGNING_SECRET` are read via `getEnvFunctions()` (so they come from the `GOOGLE_FUNCTIONS_ENV_DEV` / `_PROD` GitLab variables that build `env_functions.json` in CI — add new keys into those JSON blobs, not as standalone CI variables).
-   **LLM key never enters the sandbox (proxy)**: the real Anthropic/OpenAI key is NOT injected into the VM. The worker mints a short-lived, per-job, HMAC-signed token (`functions/Assistant/vmLlmProxy.js`, `mintProxyToken`) and points the agent at the `vmLlmProxy` `onRequest` function, passing the token in place of the key. Claude uses `ANTHROPIC_BASE_URL=<proxy>/anthropic`. Codex is configured per command with an explicit custom Responses provider whose `base_url` is `<proxy>/openai/v1` and whose `supports_websockets=false`; this is required because current Codex CLIs may otherwise open `wss://api.openai.com/v1/responses`, bypass the HTTP-only proxy, and send the proxy token to OpenAI. `OPENAI_BASE_URL` remains only as compatibility for older Codex CLIs. `vmLlmProxy` verifies the token (signature + expiry + agent-match), checks that the job can continue, swaps in the real key server-side, streams the upstream response, and accounts token usage. This means a compromised/prompt-injected agent (which runs with `--dangerously-skip-permissions` + internet) can at most leak a per-job token usable only against the proxy for its short TTL — not the permanent platform key. **`VM_PROXY_SIGNING_SECRET` is required**; if it or the upstream key/base URL is unavailable, VM execution fails closed. Rotating the secret instantly revokes all outstanding tokens. The proxy base URL defaults to the deployed function URL; override with `VM_LLM_PROXY_BASE_URL` if needed.
-   **GitLab / GitHub coding flow (clone → code → optional Merge/Pull Request)**: a `prototype` VM task can run inside a checkout of the project's connected GitLab **or** GitHub repo and open an MR/PR only when it actually changed repository files. Wiring is per-provider but symmetric: per-project repo config (`gitlabRepoUrl`/`gitlabBaseBranch`/`gitlabHost`, or `githubRepoUrl`/`githubBaseBranch`/`githubHost`/`githubApiBase`) lives on the `projects/{projectId}` doc (non-secret, member-readable); the **per-user** token lives at `users/{uid}/private/{provider}Auth_{projectId}` (`gitlabAuth_…` / `githubAuth_…`, owner+server read only — never on the project doc). The `connect{Gitlab,Github}Repo` / `disconnect{Gitlab,Github}Repo` callables (`functions/Gitlab/gitlabConnect.js`, `functions/Github/githubConnect.js`, registered in `index.js`) validate the token + repo against the provider REST API and persist it; the UI is `components/ProjectDetailedView/ProjectProperties/ConnectGitLab/` + `ConnectGitHub/` (mirror ConnectGmail, but a simple paste-token form). In `vmJobRunner.js`, `loadRepoContext()` reads the repo + the **requesting user's** token (GitHub preferred if both are connected), and `setupGitRepo()` clones (fresh) or fetches (resume) into `/home/user/repo`. The runner does **not** install repository dependencies before starting the agent; the agent installs them lazily with the repository's package manager only when the requested change or necessary validation requires them. `buildAgentPrompt()` branches on provider: **GitLab** → branch/commit/push with **push options** (`-o merge_request.create …`, no `glab`/API needed); **GitHub** → push then `gh pr create` (gh baked into the E2B template; falls back to the REST API via curl). The E2B sandbox is created/connected with internet access enabled, and Codex is invoked with `sandbox_workspace_write.network_access=true` because Codex has its own inner command sandbox; GitHub is normal outbound HTTPS traffic, not a special E2B permission, though transient DNS/network errors should be retried. The agent returns the MR/PR URL in its final message when one is opened, or explains that no MR/PR was opened because no code change was needed. **Security**: the token is injected ONLY as a per-command env var (`GIT_TOKEN`, plus `GH_TOKEN`/`GITHUB_TOKEN` for GitHub) and a git credential helper that resolves `$GIT_TOKEN` at push time (username `oauth2` for GitLab, `x-access-token` for GitHub) — never written to `.git/config`, `prompt.txt`, logs, or the paused-session snapshot. Recommend users supply a repo-scoped token (GitLab **Project Access Token** `api` + `write_repository`, Developer+; GitHub **fine-grained PAT** with Contents + Pull requests read/write) and keep the base branch protected so the agent can only open MRs/PRs, not push to it or merge.
-   **Google Cloud read access (clone the GitHub/GitLab connect pattern, but for GCP)**: any project member can connect **their own** Google Cloud project so their VM tasks can **read** its Firestore + Cloud Logging (e.g. inspect `goldStats`, tail Cloud Functions logs). It is per-user and self-limiting — you can only grant read access to a project you already have a service-account key for. The secret lives at `users/{uid}/private/gcpAuth_{projectId}` (owner+server read only; `serviceAccountKey` = the pasted SA JSON, plus `gcpProjectId`/`clientEmail`/`capabilities`); **nothing GCP-related is written to the project doc** (unlike git — the connection is purely per-user, so the per-user doc is self-contained). `connectGcpProject`/`disconnectGcpProject` (`functions/Gcp/gcpConnect.js`, registered in `index.js`) validate the key by minting a token from it and probing Firestore `:listCollectionIds` + Logging `entries:list`, storing which reads succeeded as `capabilities` and rejecting a key that can read neither. UI mirrors ConnectGitHub: `components/ProjectDetailedView/ProjectProperties/ConnectGCP/` (a paste-the-SA-JSON form). **The raw SA key never enters the sandbox.** In `vmJobRunner.js`, `loadGcpContext()` runs for **every** task type (not just `prototype`), reads the requesting user's key, and — because we hold the private key — mints a **short-lived OAuth access token** directly (`mintGcpAccessToken`: JWT→token exchange with scopes `datastore` + `logging.read`; no `iam.serviceAccountTokenCreator` / no Alldone-side IAM grant needed). **Scope gotcha**: the Firestore API rejects `cloud-platform.read-only` (403 "insufficient authentication scopes") and there is no read-only Firestore/Datastore scope, so the read/write `datastore` scope is used and **Firestore read-only is enforced by the SA's IAM role** (`datastore.viewer`), not the scope; Logging keeps its read-only `logging.read` scope. `buildGcpEnv()` injects it per-command as `GCP_ACCESS_TOKEN` (+ `CLOUDSDK_AUTH_ACCESS_TOKEN`, `GOOGLE_CLOUD_PROJECT`) merged into `runEnvs` alongside the git env — minted fresh each run, never written to disk or the paused snapshot. `buildAgentPrompt()` adds a "Connected Google Cloud project (read-only)" section pointing the agent at the Firestore/Logging **REST APIs via curl** (no `gcloud` in the E2B template by default; functions logs = filter `resource.type="cloud_run_revision"` for gen2). **Trust model** (chosen trade-off vs. the `vmLlmProxy` approach): the token is read-only (Firestore via the SA's viewer role, Logging via both scope and role), ~1h TTL, and only reaches the user's own project, so a prompt-injected agent can at most do read-only calls the user already authorized for the token's lifetime — accepted in exchange for far less code than a full proxy. Read-only ultimately rests on the SA's IAM roles, so users MUST connect a read-only SA (recommend `datastore.viewer` + `logging.viewer`, or `roles/viewer`). No Gold changes — GCP reads happen inside the run and are billed via the existing LLM-token metering. Optional future hardening: KMS-encrypt the stored SA key at rest (higher-value than a repo token), or Workload Identity Federation to avoid storing a long-lived key at all.

### Assistant heartbeat scheduler

-   Heartbeats are registered per assistant/user in the server-only `assistantHeartbeatSchedules` collection. `checkAssistantHeartbeats` only dispatches schedules due in the next five minutes; `runAssistantHeartbeat` performs one at-most-once occurrence through Cloud Tasks with five concurrent workers.
-   Run `node migration/backfillAssistantHeartbeatSchedules.js --firebase-project-id=<project> --execute` after deploying the worker and indexes. Without `--execute` the script is a dry run.
-   Cloud Tasks IAM must be granted to the **firebase-adminsdk SA** after deploying `runAssistantHeartbeat`. Run `functions/Assistant/grant-heartbeat-task-worker.sh <projectId>`; it grants project-level enqueue, self `actAs`, and `run.invoker` on the worker.
-   Rollback requires pausing or purging the `runassistantheartbeat` task queue before restoring the legacy scanner. Legacy assistant heartbeat status maps are intentionally retained.

### Code Style

-   Prettier enforces formatting (4-space indent, single quotes, trailing commas)
-   PascalCase for components (`ProjectDetailedView.js`)
-   camelCase for hooks/helpers (`useComments.js`, `taskActions.js`)
-   Husky runs `pretty-quick --staged` on commit

### Testing

-   Jest with React Native preset and JSDOM environment
-   Tests in `__tests__/` mirror component structure
-   Firebase mocks in `__mocks__/`
-   Maintain 10% coverage thresholds
-   Many tests fail due to native module mocking issues (ExpoLocalization, etc.) - this is a known limitation

### Verifying Code Changes

To verify syntax and compilation without running the full test suite:

```bash
# Start Metro bundler - this will catch syntax errors and import issues
npm run start-clean

# If Metro starts successfully without errors, the code compiles correctly
# Look for "Running Metro Bundler on port 8081" message
```

Note: Standard syntax checkers like `acorn` may fail on modern JavaScript features (optional chaining `?.`, nullish coalescing `??`) that are fully supported by the project's Babel/Metro configuration.

### Environment Configuration

-   `.env` - Current environment variables (local development only)
-   `envs/env.develop`, `envs/env.master` - Environment-specific configs
-   `env_functions.json`, `env_functions_dev.json`, `env_functions_master.json` - Function configs
-   Service accounts: `serviceAccountKey.json`, `serv_account_key_develop.json`, `serv_account_key_master.json`
-   Cloudflare worker deployment should be run from `cloudflare/email-worker/` under Node 20, not from the repo-wide Node 14 environment

### CI/CD & Deployment

-   **GitLab CI/CD**: All deployments are handled via GitLab pipelines (`.gitlab-ci.yml`)
-   **Environment secrets**: Stored in GitLab CI/CD variables, not in the repository
-   **Branches**: `develop` deploys to staging, `master` deploys to production
-   **Build process**: `ci/replace-envs.sh` injects environment variables during build
-   **Firebase projects**: `alldonestaging` (staging) and `alldonealeph` (production)

### External Services

-   **Algolia**: Search and user mentions
-   **Mollie**: Premium payments
-   **Google Calendar**: Task calendar sync
-   **Sentry**: Error monitoring
-   **SendinBlue/Brevo**: Transactional emails
-   **OpenAI/Perplexity**: AI Assistant features
