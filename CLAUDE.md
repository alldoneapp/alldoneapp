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

### Modals and Popups

Handle event propagation carefully. Set proper z-index and container `<div>` elements.

**Popover Width Control**: Most modals use `applyPopoverWidth()` from `utils/HelperFunctions.js` which applies fixed widths based on screen size (mobile/tablet/desktop). This helper overrides inline styles due to how it's applied via `style={[localStyles.container, applyPopoverWidth()]}`. To create larger modals that use more screen width, avoid `applyPopoverWidth()` and calculate width dynamically using `Dimensions.get('window').width`.

**React Native Dimensions Compatibility**: Do not use `useWindowDimensions()` in this codebase. The current React Native/web setup does not provide it reliably and it causes runtime failures such as `TypeError: useWindowDimensions is not a function`. Use `Dimensions.get('window')` instead when sizing responsive modals or panels.

**Popover Positioning and Viewport Safety**: Popovers using `react-tiny-popover` position content relative to the trigger element by default. Do not override `contentLocation` unless there is a clear reason and the behavior has been checked at narrow and short viewport sizes. The known-good task reminder/postpone date pattern is in `components/UIControls/DueDateButton.js` + `components/UIComponents/FloatModals/DueDateModal/DueDateModal.js`: keep desktop positioning library-managed with `contentLocation={smallScreen ? null : undefined}`, and make the modal itself fit the viewport with `applyPopoverWidth()`, `maxHeight: windowSize[1] - MODAL_MAX_HEIGHT_GAP`, and an internal `CustomScrollView`. For global centered popups such as `DueDateSinglePopup`, use a centered overlay wrapper and only center the popover on small-screen navigation (`contentLocation={smallScreenNavigation ? null : undefined}`). Avoid custom coordinate functions for large modals; they can render the `.react-tiny-popover-container` off-screen or invisibly. Fix size issues in the modal content instead: cap width/height to the available viewport, remove fixed minimums that exceed small screens, and scroll inside the modal.

### Gold Transactions

-   Every gold change (earn, spend, refund, adjustment) must go through `applyGoldChange` / `deductGold` / `refundGold` / `adjustGold` in `functions/Gold/goldHelper.js` so it lands in the user's `goldTransactions` subcollection. Never mutate `users/{uid}.gold` directly — the log is how users see what happened in the Gold history modal.
-   When adding a new gold spend or refund, always pass a descriptive `source` (a new machine key, e.g. `meeting_transcription`, `gmail_labeling`) plus as much linking context as you have: `projectId`, `goalId`, `objectId`, `objectType`, `channel`, and an optional human `note`. The sanitized fields are defined in `functions/Gold/goldTransactions.js` — add new fields there if you need more link context.
-   Add a human label for every new `source` in `components/SettingsView/Profile/Properties/GoldTransactionsModal.js` (`getTransactionLabel`) and a matching translation key in `i18n/translations/en.json`, `de.json`, and `es.json`. The modal falls back to `Gold transaction` if the source is unknown.
-   Prefer storing enough context that the transaction can deep-link back to its source (chat/topic, goal, contact, Gmail message, etc.). The modal's `getTransactionLink` builds the URL from `projectId` + `objectId` + `objectType` / `channel`; extend it when adding a new source type that has a natural destination.

### Gmail Follow-Up Tasks

-   Gmail follow-up tasks created from labeling prompts use `task.gmailData.origin === 'gmail_label_follow_up'`.
-   These tasks must stay in the normal task list, not the dedicated Gmail/email task bucket. Only inbox-summary Gmail tasks should be treated as email tasks.
-   Do not rewrite or sanitize the task title text for Gmail follow-up tasks. If the assistant-created title contains a Gmail link, leave it as-is.
-   In the task list row, the Gmail affordance should be rendered as an inline left tag/chip using `SocialText`'s `leftCustomElement`, not as an absolutely-positioned icon. This keeps wrapping correct so continuation lines align under the chip instead of under the first text token after it.
-   Opening a Gmail follow-up task from the chip should target the specific Gmail message and should prefer an account-aware URL flow. Current helpers live in `utils/Gmail/gmailTaskUtils.js` and `functions/Gmail/serverSideGmailLabelingSync.js`.

### IAM for firebase-admin GCP calls — use the Firebase Admin SDK SA, not the compute SA

This is a repo-wide gotcha, learned the hard way. `functions/firebaseConfig.js` initializes admin with `admin.credential.cert(serviceAccountKey.json)` (in CI, `serv_account_key_<env>.json` is copied to `serviceAccountKey.json` by `service_accounts/setup_functions.sh`). Because of that explicit cert credential, **every firebase-admin call that hits a Google Cloud API authenticates as the `firebase-adminsdk-*@<project>.iam.gserviceaccount.com` service account — NOT the Cloud Run / `<projectNumber>-compute@developer.gserviceaccount.com` runtime SA** that `gcloud run services describe` reports. So when a function needs a new GCP IAM permission (Cloud Tasks, Pub/Sub, etc.), grant the role to the **firebase-adminsdk SA**. Granting the compute SA looks right but does nothing (cost us ~an hour of "still denied" past propagation). IAM changes also take up to ~7 min to propagate — wait before re-testing.

### Assistant VM Tool (`execute_task_in_vm`) & Cloud Tasks worker

-   The tool hands long-running, open-ended work to a Claude Code agent in an ephemeral **E2B** sandbox and posts the result back into the chat. Flow: `assistantHelper.js` dispatch → `functions/Assistant/vmJob.js` (`startVmJob`: validate, gold charge, write `pendingWebhooks` + `vmJobs` docs, post status comment, enqueue) → `runVmJob` (`onTaskDispatched` in `index.js`) → `functions/Assistant/vmJobRunner.js` (E2B sandbox + headless `claude -p`, streams progress, posts result, refunds gold on failure). Reuses the existing `pendingWebhooks` async-job collection.
-   It is **opt-in** — excluded from `DEFAULT_ALLOWED_TOOLS` (`toolOptions.js`), so it must be enabled per assistant in the Tools Access UI.
-   **Agent choice**: the tool takes an optional `agent` param (`claude` | `codex`, default `claude`). You can additionally pass `agentModel` (defaults: Claude → `opus` alias, Codex → `gpt-5.5`) and `agentReasoningEffort` (defaults to `high`, Claude uses `--effort`, Codex uses `model_reasoning_effort`). The resolved model + effort are surfaced to the user in the VM status comment — both the initial "Spinning up …" message (`vmJob.js`) and the live "Working with … in a VM" header (`vmJobRunner.js`) render a `(<model> · <effort> effort)` suffix via the shared `formatAgentRunSuffix` / `resolveAgentRunDetails` helpers, so the defaults are applied identically whether or not the assistant set them on the tool call. `vmJobRunner.js`'s `AGENT_CONFIGS` maps the agent to the matching **E2B prebuilt template** (`claude`/`codex`), API key (Claude → `ANTHROPIC_API_KEY`; Codex → `OPEN_AI_KEY` passed as `CODEX_API_KEY`/`OPENAI_API_KEY`), headless command (`claude -p … --model <id> --effort <level> --output-format stream-json` vs `codex exec --model <id> -c model_reasoning_effort=high --json`), and a per-agent JSON-stream parser that drives the live activity feed in the chat. `E2B_CLAUDE_TEMPLATE`/`E2B_CODEX_TEMPLATE` are **optional overrides** of E2B's prebuilt template names — prefer the prebuilt `claude`/`codex` templates over hand-rolled ones.
-   **Persistent per-thread session (resume)**: each chat thread keeps one VM session. After a run the worker **pauses** the sandbox (snapshotting filesystem + the agent's session store) and records its id on `vmSessions/{projectId}__{objectId}`; the next `execute_task_in_vm` in that thread **resumes** it (`Sandbox.connect`) and runs the agent with `--continue` (Claude) / `codex exec resume --last` so it keeps prior files + conversation. `e2b@1.x` has no `pause()` — we POST the pause REST endpoint (`api.e2b.dev/sandboxes/{id}/pause`, `X-API-KEY`) directly; resume is `Sandbox.connect`, cleanup is `Sandbox.kill`. After a run the sandbox is **kept running for a ~10-min keep-alive window** (so back-to-back tasks in a thread hit a live VM with no resume latency); the `pauseIdleVmSessions` schedule (every 2 min) pauses sessions idle past that window, and `cleanupIdleVmSessions` deletes them after 7 days. The sandbox self-kill timeout (15 min) sits above the grace window + pauser interval so the pauser always pauses (preserving state) before E2B would kill the idle VM. `collectArtifacts` filters by `modifiedTime` so a resume only re-attaches files written in that run. Caveat: persistence is an E2B beta — validate across multiple resumes ([E2B #884](https://github.com/e2b-dev/E2B/issues/884)).
-   **File/artifact return**: the agent is told to save deliverable files to `/home/user/output/` only when the user requested a file or the work genuinely produces an artifact; normal chat answers should stay in the final message with no generated output file. Before tearing down the sandbox, the worker pulls those files out (`sandbox.files.list/read`), uploads them to Firebase Storage at `attachments/{commentId}/{file}` (with a `firebaseStorageDownloadTokens` metadata token), and attaches them to the result comment. **Inline downloadable rendering requires embedding an attachment token in the comment text** — `${ATTACHMENT_TRIGGER}{url}${ATTACHMENT_TRIGGER}{name}${ATTACHMENT_TRIGGER}false` (trigger `EbDsQTD14ahtSR5`, see `components/Feeds/Utils/HelperFunctions.js`), which the chat parses into a `FileDownloadableTag`. The `mediaContext` array alone does NOT render an inline download, and a bare filename in the text gets auto-linkified to a bogus URL by `REGEX_URL`, so always use the token. We also store `mediaContext` for the assistant read-side. Caps: 10 files, 20 MB/file, 40 MB total. Uses the existing `roles/storage.admin` on the firebase-adminsdk SA.
-   **Gold pricing is hybrid + metered** (`VM_JOB_BASE_GOLD` + `VM_GOLD_PER_MINUTE` + `VM_TOKENS_PER_GOLD` in `vmJob.js`): a small base reserve is charged up-front in `startVmJob` (refunded on failure), then the worker charges a top-up on completion = `ceil(runtimeMinutes) * perMinute + round(totalTokens / tokensPerGold)`. Tokens come from the agent's actual reported `usage` (Claude `result` event incl. `total_cost_usd`; Codex `turn.completed`), captured in the stream parser and stored on the `vmJobs` doc. Token rate matches in-app assistant usage (100 tokens/Gold) — VM compute (~\$0.001–0.002/min on E2B) is minor vs the LLM tokens, which dominate.
-   **Cloud Tasks IAM (three grants, NOT auto-configured by `firebase deploy`)** — all on the firebase-adminsdk SA (see gotcha above): (1) `roles/cloudtasks.enqueuer` at the **project level** (queue-scoped was observed not to be honored for firebase-admin's `enqueue()`), (2) `roles/iam.serviceAccountUser` on the SA itself (`actAs`, to mint the task's OIDC token), and (3) `roles/run.invoker` on the **`runvmjob`** Cloud Run service (gen2 lowercases the function name) so Cloud Tasks can invoke the worker. The denials surface one at a time as you fix them (`cloudtasks.tasks.create` → `iam.serviceAccounts.actAs` → `run.invoker`). Run `functions/e2b-template/grant-enqueuer.sh <projectId>` once per environment after deploy; it auto-detects the SA and applies all three.
-   **E2B SDK is pinned to `e2b@^1.x`** in `functions/package.json` — v2 cannot load under the Node 20 CommonJS functions runtime (`ERR_REQUIRE_ESM` from its CJS bundle; `Dynamic require of node:url` from its ESM bundle under raw `node`). The Docker-free v2 **template build** tooling lives isolated in `functions/e2b-template/` (its own ESM package, run via `tsx`) and is excluded from the functions deploy via `firebase.json` `functions.ignore`.
-   **Template** (`functions/e2b-template/build.ts`): image install steps must run with `{ user: 'root' }` (Build System 2.0 runs `runCmd` as the non-root `user`). Claude Code is baked in at build time (set `E2B_CLAUDE_TEMPLATE` to use it) — it does **not** auto-update, and E2B caches build layers by command string, so bump a pinned version or `--no-cache` to refresh it. Without the template, the worker `npm i -g @anthropic-ai/claude-code` per run (slower).
-   Secrets `E2B_API_KEY`, `ANTHROPIC_API_KEY`, `E2B_CLAUDE_TEMPLATE`, `VM_PROXY_SIGNING_SECRET` are read via `getEnvFunctions()` (so they come from the `GOOGLE_FUNCTIONS_ENV_DEV` / `_PROD` GitLab variables that build `env_functions.json` in CI — add new keys into those JSON blobs, not as standalone CI variables).
-   **LLM key never enters the sandbox (proxy)**: the real Anthropic/OpenAI key is NOT injected into the VM. The worker mints a short-lived, per-job, HMAC-signed token (`functions/Assistant/vmLlmProxy.js`, `mintProxyToken`) and points the agent at the `vmLlmProxy` `onRequest` function via `ANTHROPIC_BASE_URL=<proxy>/anthropic` (Claude) / `OPENAI_BASE_URL=<proxy>/openai/v1` (Codex), passing the token in place of the key. `vmLlmProxy` verifies the token (signature + expiry + agent-match, no DB read), swaps in the real key server-side, and streams the upstream response back. This means a compromised/prompt-injected agent (which runs with `--dangerously-skip-permissions` + internet) can at most leak a per-job token usable only against the proxy for its short TTL — not the permanent platform key. **`VM_PROXY_SIGNING_SECRET` is required to ENABLE the proxy**; if it's unset the worker falls back to injecting the real key directly (legacy, less secure) with a warning, so set it in both `GOOGLE_FUNCTIONS_ENV_DEV`/`_PROD`. Rotating the secret instantly revokes all outstanding tokens. The proxy base URL defaults to the deployed function URL; override with `VM_LLM_PROXY_BASE_URL` if needed. Codex's `OPENAI_BASE_URL` handling is less standardized than Claude's — validate Codex against the proxy before relying on it. Token-budget enforcement + active-job revocation on the proxy are possible future hardening (kept off the hot path for now).
-   **GitLab / GitHub coding flow (clone → code → optional Merge/Pull Request)**: a `prototype` VM task can run inside a checkout of the project's connected GitLab **or** GitHub repo and open an MR/PR only when it actually changed repository files. Wiring is per-provider but symmetric: per-project repo config (`gitlabRepoUrl`/`gitlabBaseBranch`/`gitlabHost`, or `githubRepoUrl`/`githubBaseBranch`/`githubHost`/`githubApiBase`) lives on the `projects/{projectId}` doc (non-secret, member-readable); the **per-user** token lives at `users/{uid}/private/{provider}Auth_{projectId}` (`gitlabAuth_…` / `githubAuth_…`, owner+server read only — never on the project doc). The `connect{Gitlab,Github}Repo` / `disconnect{Gitlab,Github}Repo` callables (`functions/Gitlab/gitlabConnect.js`, `functions/Github/githubConnect.js`, registered in `index.js`) validate the token + repo against the provider REST API and persist it; the UI is `components/ProjectDetailedView/ProjectProperties/ConnectGitLab/` + `ConnectGitHub/` (mirror ConnectGmail, but a simple paste-token form). In `vmJobRunner.js`, `loadRepoContext()` reads the repo + the **requesting user's** token (GitHub preferred if both are connected), `setupGitRepo()` clones (fresh) or fetches (resume) into `/home/user/repo`, and the worker does a best-effort JS dependency install (`npm ci`, `pnpm install --frozen-lockfile`, etc.) so local scripts can find tools like `eslint`. `buildAgentPrompt()` branches on provider: **GitLab** → branch/commit/push with **push options** (`-o merge_request.create …`, no `glab`/API needed); **GitHub** → push then `gh pr create` (gh baked into the E2B template; falls back to the REST API via curl). The E2B sandbox is created/connected with internet access enabled, and Codex is invoked with `sandbox_workspace_write.network_access=true` because Codex has its own inner command sandbox; GitHub is normal outbound HTTPS traffic, not a special E2B permission, though transient DNS/network errors should be retried. The agent returns the MR/PR URL in its final message when one is opened, or explains that no MR/PR was opened because no code change was needed. **Security**: the token is injected ONLY as a per-command env var (`GIT_TOKEN`, plus `GH_TOKEN`/`GITHUB_TOKEN` for GitHub) and a git credential helper that resolves `$GIT_TOKEN` at push time (username `oauth2` for GitLab, `x-access-token` for GitHub) — never written to `.git/config`, `prompt.txt`, logs, or the paused-session snapshot. Recommend users supply a repo-scoped token (GitLab **Project Access Token** `api` + `write_repository`, Developer+; GitHub **fine-grained PAT** with Contents + Pull requests read/write) and keep the base branch protected so the agent can only open MRs/PRs, not push to it or merge.

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
