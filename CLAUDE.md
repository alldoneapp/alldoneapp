# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

It is kept short on purpose: it is loaded into every session. The detailed notes (incident
histories, design decisions, the tests that pin them) live in `docs/claude/`. **Before changing
an area, read its file from the index below.** When you learn something new, add it to the
matching topic file, not here; add a line here only if it applies to almost every change.

## Project Overview

Alldone is a React Native/Firebase productivity platform supporting tasks, goals, notes, contacts, and real-time collaboration. Runs on iOS, Android, and web with shared codebase.

## Development Commands

```bash
# Git worktree setup (run once per new worktree, before anything else)
sh setup-worktree.sh         # Links node_modules, functions/, web-bundler/, .env

# Development
npm run dev                  # Full emulator suite, then HTTPS dev server on port 19006

# Optional separate terminals (instead of npm run dev)
npm run emulators            # Auth, Firestore, Functions, Storage, Database, Pub/Sub
npm run dev:web              # HTTPS web server connected to the already running suite

# Testing
npm test                     # Run Jest tests
npm test -- --testPathPatterns="TaskList"  # Run single test file (jest 30: plural flag)
npx jest --config ci/jest.functions.config.js functions   # Functions suite (run before pushing functions/ changes)
npm run coverage             # Generate test coverage
npm run update-snapshots     # Update Jest snapshots

# Build & Deploy
npm run build-web-webpack    # Build for web production (webpack 5 — see web-bundler/)
npm run format-code          # Format with Prettier
```

**Required versions**: Node 22.23.4 or newer within Node 22 (repo-wide, `.nvmrc`, also
`cloudflare/email-worker/`), npm 10, firebase-tools 13.29.3. The whole repo runs on Node 22; the
Expo/Metro era is over. `react-native` imports resolve to `react-native-web` in webpack and Jest;
do not restore native tooling. Details: `docs/claude/tooling.md`.

**Verifying a change compiles**: `npm run build-web-webpack`. A clean compile ends with
`webpack compiled with 3 warnings` (the three RNGH DrawerLayoutAndroid warnings); anything else is
a real finding. A clean compile proves little about runtime: boot it in a browser before trusting a
bigger change.

## Architecture Overview

- `components/` - Feature-based UI (TaskListView/, GoalsView/, NotesView/, ContactsView/, etc.)
- `utils/backends/` - Firebase abstraction layer (firestore.js, openTasks.js, doneTasks.js)
- `utils/BackendBridge.js` - Central Firebase operations facade
- `URLSystem/` - Custom routing (`URLSystemTrigger.js`, one trigger file per feature)
- `redux/` - State management (actions.js, store.js; redux 5 + react-redux 9, hooks only)
- `functions/` - Firebase Cloud Functions (v2 syntax: `onDocument*`, `onSchedule`, `onCall`, `onRequest`); they cannot import app code
- `i18n/translations/` - Localization (en.json, de.json, es.json)
- `web-bundler/` - The deployed webpack 5 build
- Entity screens follow `[Entity]DetailedView` naming (TaskDetailedView, GoalDetailedView, …)

## Rules that apply to almost every change

Each rule has its reasoning in the named topic file.

**Frontend**

- Firebase client SDK is v12 via `firebase/compat`. **Never call `getFirestore(app)`**: it creates
  a second client. Use `getDb()._delegate` for modular helpers. (`firebase-client.md`)
- Never write `export default Name = (...)`; it crashes the main chunk under ES modules with no
  console error. Write `const Name = (...); export default Name`. (`tooling.md`)
- Do not use `useWindowDimensions()` (fails at runtime here); use `Dimensions.get('window')` or the
  existing hooks. (`web-shell-and-popups.md`)
- React stays on 18.3.1. Add no new `ReactDOM.render`, `unmountComponentAtNode` or `findDOMNode`.
  In a Quill blot use `renderEmbedContent(node, element)`, never `ReactDOM.render(element, node)`.
  (`state-and-performance.md`, `editor-quill-yjs.md`)
- Never subscribe an all-projects view to a whole `xByProject` redux map. (`state-and-performance.md`)
- New popups size through `useModalSizing` / `utils/modalSafeArea.js`; build on `AppPopover`
  instead of importing `react-tiny-popover`. Escape handling goes through `useEscapeKey`.
  (`web-shell-and-popups.md`)
- Never `await` a Firestore write where a server ack may not come (offline): use
  `awaitWriteAck`. Online-only features fail fast offline with `code: 'offline'`. (`offline.md`)
- Links that open member-written data go through `utils/safeUrl.js`. Build stored links with
  `getAppLinkOrigin()`, never `window.location.origin`. (`rules-and-access.md`, `editor-quill-yjs.md`)
- Always consider i18n: add strings to `en.json`, `de.json` and `es.json`; use TranslationService.

**Backend and data**

- Project membership is `projects/{pid}.userIds`, never the arrays on `users/{uid}`. Use
  `isProjectMemberData` / `filterMemberProjectIds`. (`security.md`)
- A callable acts as `request.auth.uid`, checks `assertProjectAccess`/`assertObjectAccess`, and
  loads trusted settings from stored documents, never from `request.data`. A Firestore trigger has
  no `request.auth`, so any field it acts on as a user must be bound to its writer in
  `firestore.rules`. (`security.md`, `rules-and-access.md`)
- Every Gold change goes through `functions/Gold/goldHelper.js` with a `source` and linking
  context; a new source needs a label in `GoldTransactionsModal.js` and translations. Never write
  `users/{uid}.gold`. (`gold-and-growth.md`)
- Grant GCP IAM roles for function behaviour to the `firebase-adminsdk-*` service account, not the
  compute SA. (`functions-runtime.md`)
- Function timeout ceilings: 3600s for HTTP/schedule, 1800s for `onTaskDispatched`, 540s for event
  triggers. Exceeding one fails the deploy silently for that function. A function that hosts an
  assistant prompt run derives its timeout from `assistantRunLimits.js` and takes the run lock.
  (`functions-runtime.md`, `assistant-runs.md`)
- `firebase-admin` stays on ^13. Take statics from `firebase-admin/firestore`. (`testing.md`)
- A new environment secret must also be listed in `functions/envFunctionsHelper.js`, or it is
  `undefined` at runtime. (`assistant-models-and-tools.md`)
- A server-side fetch of a URL someone else chose goes through `shared/outboundUrlGuard.js`.
  (`security.md`)
- Never deploy Firestore indexes with `--force`. Always pass `--project` (`.firebaserc` defaults to
  staging). (`ci-cd.md`)
- A note document has no `content`; the body is a Yjs binary in the notes bucket. Never read a note
  for a model or for offsets with `Y.Text.toString()`. (`notes-tasks-feeds.md`)

**Assistant tools**: when adding a tool, wire every layer: schema in
`functions/Assistant/toolSchemas.js` (+ test), execution in `assistantHelper.js` (+ test), Tools
Access entry in `toolOptions.js` (decide `DEFAULT_ALLOWED_TOOLS` vs `OPT_IN_ONLY_TOOLS`), labels in
all three translation files, channel allowlists (e.g. `GMAIL_POST_LABEL_SAFE_TOOLS`), and the MCP
side (`MCP_DELEGATED_ASSISTANT_TOOLS` + `MCP_TOOL_KEYS`). MCP and assistants offer the same
features on the same code; a write over MCP also writes its Updates entry. Full checklist:
`mcp.md`.

## Topic index (`docs/claude/`)

| File                             | Read before working on                                                                                                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tooling.md`                     | Node/npm versions, emulators, web-bundler, `replacement_node_modules` patches                                                                                                    |
| `firebase-client.md`             | Firebase client SDK, `users/` reads as probes vs assertions, `permission-denied` that is not a denial                                                                            |
| `editor-quill-yjs.md`            | Quill 2 editor, focus scroll, drops/paste/undo, embeds and blots, task tags and mentions in notes, Yjs formatting                                                                |
| `state-and-performance.md`       | Redux store, per-project selectors, Goals board performance, performance telemetry                                                                                               |
| `functions-runtime.md`           | Functions runtime pins, timeout ceilings, IAM service account                                                                                                                    |
| `assistant-runs.md`              | Workflow AI steps, background runs, run idempotency/locks, missed-run catch-up, one turn per thread, thread model pins, heartbeats, scheduled tasks                              |
| `assistant-models-and-tools.md`  | Assistant model menu and Gold rates, DeepSeek/OpenRouter, hosted tool search, MCP app grouping and views, embed windows                                                          |
| `security.md`                    | Callable identity rules (2026-11 audit), payments, membership authority, trigger-bound fields, assistant memory, fan-outs, outbound fetch, video/IP/deleted projects, iOS bridge |
| `wiki.md`                        | Project wiki ingest, visibility, withdrawal, corrections, documents, search, feed lines                                                                                          |
| `artifacts.md`                   | Artifacts: serving origin, links, sandboxing, assistant tools, linked uploads, history, live data bridge                                                                         |
| `mcp.md`                         | MCP actor marker, workspace setup tools, Updates entries for MCP changes, browser agents, alldone.team specialists, goal/OKR/contact/artifact tools, tool checklist and parity   |
| `browsing.md`                    | `browser_*` tools, policy, approvals, billing, allowlist editor                                                                                                                  |
| `web-shell-and-popups.md`        | App shell scrolling, iOS safe areas, popup sizing, Escape handling, modal system, bottom sheets, assistant workspace viewport, Anna activity/composer                            |
| `offline.md`                     | Connectivity signal, offline notes, persistence, tab handoff, cached snapshots, service worker, logout cleanup, write acks                                                       |
| `task-row-interactions.md`       | Swipeable rows, task completion animation, gold coin animation                                                                                                                   |
| `celebrations.md`                | Empty-inbox celebration, per-project sweep and disintegration (mostly disabled)                                                                                                  |
| `skyline.md`                     | Empty inbox 3D skyline                                                                                                                                                           |
| `rage-mode.md`                   | Rage mode game                                                                                                                                                                   |
| `voice-and-dictation.md`         | GPT-Live voice calls, background calls, Rambler dictation, silent microphones, push-to-talk, vocabulary                                                                          |
| `notes-tasks-feeds.md`           | Notes bucket, note text projection, due dates, recurrence, day-rate logging, happiness, feed cleanup and privacy                                                                 |
| `gold-and-growth.md`             | Gold ledger rules, rewards, usage settlement, analytics rollups, growth scoreboard                                                                                               |
| `contact-enrichment.md`          | Contact "Enrich profile"                                                                                                                                                         |
| `email.md`                       | Gmail follow-ups, email line, read-state sync, email thread topics, sender identity, OAuth binding, DKIM, verified emails, alldone.team billing                                  |
| `calendar-reminders-whatsapp.md` | Calendar sync, task reminders, phone routing, WhatsApp runs and result mirroring                                                                                                 |
| `vm.md`                          | `execute_task_in_vm`, approval policy, agents and models, OpenRouter, sessions and queue, repos, GCP access, golden templates                                                    |
| `testing.md`                     | Jest config, transform allowlist, functions suites, firebase-admin pin                                                                                                           |
| `ci-cd.md`                       | Pipelines, staging/production deploys, deploy guards and markers, credentials, Functions selection, CI images, Firestore indexes                                                 |
| `rules-and-access.md`            | Firestore/Storage rules, link-shared projects, safe URLs, joining projects, OAuth callback rewrites                                                                              |
| `cloud-cost.md`                  | Cloud cost review and decisions                                                                                                                                                  |

Older plans and audits also live in the repo root (`*_PLAN.md`, `TYPESENSE_MIGRATION.md`) and in
`docs/`.

## Code Style

- Prettier 3 enforces formatting (4-space indent, single quotes, trailing commas);
  `.prettierignore` deliberately shields email/invoice HTML templates, the build-injected
  index.html files, and the quill-derived editor CSS — do not format those
- PascalCase for components (`ProjectDetailedView.js`)
- camelCase for hooks/helpers (`useComments.js`, `taskActions.js`)
- Husky 9 (`.husky/pre-commit`) runs `pretty-quick --staged` on commit

## Testing

- Jest 30 on Node 22, jsdom. Tests in `__tests__/` mirror component structure; newer tests sit
  next to their code. Firebase mocks in `__mocks__/`. Maintain 10% coverage thresholds.
- A new dependency that throws `Unexpected token 'export'` in tests belongs in
  `transformIgnorePatterns` (package.json).
- CI's `test:web:changed` excludes `functions/`; run the functions suite locally before pushing
  anything under `functions/`. When a test double stops matching what the code reads, fix it and
  check the still-green cases are not green for the wrong reason.

## Environment and deployment

- `.env` (local only), `envs/env.develop`, `envs/env.master`, `env_functions*.json`; secrets live in
  GitLab CI/CD variables.
- GitLab CI (`.gitlab-ci.yml`): `develop` deploys to staging (`alldonestaging`), `master` to
  production (`alldonealeph`). Staging deploys only from `develop`.
- Firestore rules are live only after `deploy:firestore:rules:production` publishes them; Storage
  rules are published by hand through the Rules API. (`ci-cd.md`, `rules-and-access.md`)

## External Services

- **Algolia / Typesense**: Search and user mentions
- **Mollie / Stripe / RevenueCat**: Payments
- **Google Calendar / Gmail / Microsoft**: Calendar sync, email
- **Sentry**: Error monitoring
- **SendinBlue/Brevo**: Transactional emails
- **OpenAI / OpenRouter / Perplexity / Deepgram**: AI Assistant features
- **E2B**: VM sandboxes
