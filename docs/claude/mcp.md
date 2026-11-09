# MCP server, browser agents, MCP/assistant tool parity

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## An MCP client acts in the user's name, and says so

Claude, Codex and other MCP clients have no account of their own: every MCP tool runs as the
OAuth-authenticated user (`assistantId = null`), so `creatorId` / `lastEditorId` is the user, which
is right for access and ownership. Two things were wrong with that and both are fixed by one marker,
`{ via: 'mcp', viaClient: 'Claude' }` (`functions/shared/mcpActor.js`): the app could not tell the
agent's work from the user's own, and the user was never notified of it, because every fan-out skips
the actor. The marker is stamped on feeds (`generateFeedModel`, both copies), comments and their
chat/push notifications (`TaskCommentService`), wiki revision authors, artifact versions and
their history events (`commitArtifactVersion({ actorChannel })`, `setArtifactDataAccess`), and the
`lastEditorVia` of a task or an artifact (bound to `lastEditionDate`, because the app writes
`lastEditorId` without knowing to clear it; the artifact update trigger reads it to label a rename). The app renders it as "Karsten Wysk (via Claude)" (`utils/mcpActorLabel.js`,
`getFeedCreatorPresentationData`); readers must keep using the user's id for avatar and navigation.
Every notification path that skips the actor keeps the actor when the marker is present:
`increaseFeedCount`, `TaskCommentService.addComment`, the wiki feed and the WhatsApp initiator guard
(`initiatorVia`). An MCP `update_task` comment is therefore not silent, unlike an assistant's.

`viaClient` comes from the `clientInfo.name` the client sends with `initialize`, remembered on its
`oauthTokens` / `oauthRefreshTokens` documents (`mcpClientName`, carried over on refresh), and is
only ever one of the labels in `MCP_CLIENT_LABELS` — a client's self-description is rendered to every
project member, so an unknown name is shown as "via MCP", never verbatim. Production clients report
`codex-mcp-client`, `Anthropic/ClaudeAI`, `claude-code`. A token from before this shipped is labelled
once its client next initializes. A new MCP-reachable tool that writes feeds or comments gets the
marker for free if it builds its actor with `getAssistantFeedUserForTool(..., toolRuntimeContext)`.
Pinned by `functions/shared/mcpActor.test.js`, `functions/MCP/mcpClientAttribution.test.js`,
`functions/Feeds/globalFeedsHelper.mcpActor.test.js` and the MCP cases in `TaskCommentService.test.js`.

**MCP can set up a workspace, and nothing else configures one over MCP.** Seven MCP-only tools in
`functions/MCP/mcpWorkspaceSetupTools.js` let a client set up a working structure for the user:
`create_project` (optionally with contact statuses), `add_contact_statuses`, `create_assistant`,
`update_assistant` (name, description, instructions, model, Tools Access, project assistant),
`create_assistant_task` (a recurring prompt the assistant runs for the caller), `get_assistant_tasks` and
`update_assistant_task` (prompt, name, rhythm, start, WhatsApp, goal, pause/resume for the caller). The
tools are shared with assistants (see "MCP and assistant tools offer the same features" below):
`update_assistant` is MCP's side of `update_assistant_settings`, the other six run the same handlers
for an assistant. Three rules keep agents from making a mess:

- **Idempotent by name.** A second call with an existing project, assistant or task name returns
  the existing object (`alreadyExisted: true`) instead of creating a duplicate.
- **Capped per user per day.** The caps are in `DAILY_LIMITS`; the counter lives at
  `users/{uid}/private/mcpWorkspaceSetupQuota`.
- **No more than the app's own screens allow.** Tools Access keys come from a copy of `toolOptions.js`
  (`ASSISTANT_TOOL_KEYS`, pinned by `__tests__/MCP/mcpWorkspaceSetupToolKeysParity.test.js`), and models
  from `SELECTABLE_ASSISTANT_MODELS`.

The documents are built field for field like the app's own forms (`getNewDefaultProject`,
`getNewDefaultAssistant`, `PreConfigTaskModal`). An assistant task stores its start the same way the
form does: the UTC instant of the local start, the local `HH:mm` and the offset. Every change writes
its Updates entry (see "Every change made over MCP shows in Updates" below); `onCreateProject` still
runs. Assistant tasks are `direct` mode only. Each tool
is its own switch under Settings → MCP. Pinned by `functions/MCP/mcpWorkspaceSetupTools.test.js`.

A scheduled assistant task runs on its own copy of the instructions (`aiSystemMessage`, copied at
creation and preferred over the assistant's `instructions` at run time), so changing an assistant's
instructions alone would never reach its schedules. `update_assistant` therefore also rewrites the
copy of every task of that assistant whose copy still equals the OLD instructions; a task whose copy
somebody edited keeps it. Tool changes keep list entries that are not Tools Access keys (written by
older app versions), and a call that changes nothing writes nothing and spends no quota.

`update_assistant_task` keeps the stored start date when only `startTime` changes: the start date is
the anchor of the rhythm (a weekly task runs on that date's weekday), and `buildSchedule` would
otherwise default it to today. The rhythm is stored per user (`recurrenceByUser`) next to the task's
default and follows the caller; pausing removes the caller from `activatedUserIds` and
`recurrenceByUser`, the same fields the scheduler (`assistantRecurringTasks.js`) reads on every tick,
so nothing else has to be recomputed. Edits carry `lastEditedVia`. Pinned by the
`get_assistant_tasks and update_assistant_task` block of `mcpWorkspaceSetupTools.test.js`.

**A scheduled assistant task can file its runs under a goal.** `parentGoalId` on the scheduled task
(set with `create_assistant_task` / `update_assistant_task`, a goal of the same project the caller
can see) makes every run create its task with that goal, through the same fields `create_task` uses
(`buildTaskParentGoalFields`: id, the goal's audience, lock key) plus `skipAutomaticGoalRouting`, so
the goal router does not refile it (`Assistant/scheduledTaskGoal.js`, called from
`ensureTaskChatExists`). A goal that is gone or not visible to the activator is skipped and the run
happens unfiled. A goal
whose milestone is done keeps receiving runs until the goal is changed. Pinned by
`Assistant/scheduledTaskGoal.test.js`, the `scheduled task goal` block of
`assistantRecurringTasks.test.js` and the `goals of scheduled tasks` block of
`mcpWorkspaceSetupTools.test.js`.

**`projectAssistant` on `create_assistant` / `update_assistant` makes an assistant the project
assistant** the way the assistant's "Default" switch in the app does (`setAssistantLikeDefault`):
`projects/{id}.assistantId` plus `isDefault: true` on it and `false` on the project's other
assistants. `false` clears both when the assistant is the current one. Only assistants of the project
itself, not global ones, and no "changed project assistant" Updates entry (the client writes that one;
the setup tools write no feeds). Pinned by the `project assistant` block of
`mcpWorkspaceSetupTools.test.js`.

## Every change made over MCP shows in Updates (decision 2026-11-09)

**Rule:** a change an MCP client makes to Alldone data writes an Updates (activity feed) entry, and
because MCP and assistant tools run the same code, so does the same change made by an assistant (the
actor is then the assistant). Over MCP the actor is the user with the MCP marker, so the line reads
"Karsten Wysk (via Claude)". **Not entries:** private user memory, comments (they show as comments
already) and sign-in data. **Gmail and Calendar actions are entries**, visible to the members of the
project the connection belongs to (Karsten's choice over "only me"): subject or title, recipients or
attendees, labels and times, never a body, an event description or Bcc. A new tool that writes must
write its entry too; leaving one out needs a reason in this section.

Where the entries are written, all best-effort after the change (a failed entry is logged and never
fails the change), each loading the feed state first like `Goals/goalToolFeeds.js`:

- **Assistants and projects** (`Feeds/workspaceChangeFeeds.js`): project created, contact statuses
  added, project assistant switched, assistant created (the person who asked follows it), one entry
  per changed assistant field (name, description, picture, instructions, model, temperature, voice,
  delegation description, Tools Access) from `update_assistant` and `update_assistant_settings`
  alike, heartbeat settings, scheduled assistant tasks created or changed (on the assistant). A
  global assistant gets none, as in the app. Callers in `assistantHelper.js` pass `getFeedUser`, so
  the actor is looked up only when an entry is written.
- **Contacts and moves**: every field `update_contact` changes (`contactUpdateHelper.js`), a contact
  created on the fly ("added", `resolveContactTarget` takes `feedUser`), task and note project moves
  over a tool (their existing "moved" entries, now with the tool's actor), and the global user
  description (on the user in the default project).
- **Goals, milestones, OKRs, wiki**: goal date and scheduling changes (`FEED_GOAL_MILESTONE_CHANGED`),
  milestones and OKRs on the project (`Feeds/projectEntryFeeds.js`, which narrows a private entry to
  its audience; an OKR's later privacy change rewrites its entries in
  `onUpdateOkrAccessProjectionSecondGen`), and wiki sources (documents, saved knowledge) as
  `FEED_WIKI_SOURCE_CHANGED` lines on the wiki that carry **no** title or text, for the same reason
  wiki revision lines carry none.
- **Gmail and Calendar** (`Feeds/integrationToolFeeds.js`, one hook in `executeToolNatively` after a
  successful tool result, so the email line, booking and labeling sync, which call the helpers
  directly, write nothing): `FEED_PROJECT_EMAIL_ACTIVITY` / `FEED_PROJECT_CALENDAR_ACTIVITY` on the
  connection's project. Only the mailbox owner gets the unread badge. Repeated single-email changes
  within 10 minutes are merged into one entry with a count (state at
  `users/{uid}/private/integrationActivityFeed`).
- **Artifacts**: see the artifacts section.

Feed types are the same value on the server (`functions/Feeds/FeedsConstants.js`) and the web
(`components/Feeds/Utils/FeedsConstants.js`), where a new type joins its kind's `FEED_<KIND>_TYPES`
list so it is routed and rendered (`RegularFeed`, "<actor> <entryText>"). `get_updates` keeps its own
map (`EVENT_TYPE_TO_OBJECT_TYPE` in `shared/UpdateRetrievalService.js`);
`UpdateRetrievalServiceFeedTypes.test.js` fails when a web type is missing there, which is how
`FEED_PROJECT_HAPPINESS` and `FEED_ASSISTANT_TEMPLATE_SYNCED` were found unmapped.

## Browser agents use the MCP tools through the signed-in page (AT-2871)

Assistants that cannot add a custom connector but can drive a browser (Gemini in Chrome, Claude in
Chrome, ChatGPT agent, Comet) get the same tools in a signed-in Alldone tab, on two surfaces:
**native WebMCP** (`document.modelContext.registerTool`, with `navigator.modelContext` as the
deprecated alias) and **`window.alldone`** (`listTools`, `callTool`, `tools.<name>(args)`, `help()`)
for agents that only run JavaScript. `utils/browserAgent/browserAgentApi.js` implements both, and
`components/BrowserAgent/BrowserAgentApiBridge.js` mounts them in the logged-in tree. Neither has
tools of its own. Both call the existing `/mcpServer` (same origin, through the hosting rewrite) with
the user's Firebase **ID token**, which `getAuthenticatedUserFromToken` already accepted. So
membership, visibility, Settings → MCP (master switch and per-tool opt-outs) and rate limits apply
unchanged, and nothing works signed out. The bridge sends `X-Alldone-Mcp-Client:
alldone-browser-agent`. The server honours that header **only for an ID token** (an OAuth token
keeps the name it reported in `initialize`), labels writes "via Browser agent" (`mcpActor.js`), and
refuses the bridge when `users/{uid}.browserAgentToolsEnabled === false` (Settings → MCP → "Browser
agents", on by default). The header is not a security boundary: a page that omits it is ordinary MCP
with the user's own rights.

Three things to know. **WebMCP is not a standard yet.** It is a W3C Community Group draft, and Chrome
149–156 expose it only to origins with an **origin-trial token**: paste one per host into
`utils/browserAgent/webMcpOriginTrial.js`, or the API does not exist and only `window.alldone` works.
**ID tokens are JWTs whose first characters are identical for every user**, so the rate limiter's
`client:` key (a token prefix) used to put every browser session into one bucket. JWT-shaped tokens
are now hashed (`getClientIdFromRequest`). **Discovery** is `/llms.txt` (`web-bundler/static`) plus
an `ai-agent-api` meta tag and the `data-alldone-agent-api` attribute. An agent that only fetches
URLs and cannot use a signed-in browser still needs the OAuth connector. Pinned by
`utils/browserAgent/browserAgentApi.test.js`, `components/BrowserAgent/BrowserAgentApiBridge.test.js`
and `functions/MCP/mcpBrowserAgent.test.js`.

**An agent that cannot find the API cannot use it, and the first version was hidden from every
check an agent actually runs (AT-2890).** `window.alldone` was installed with `Object.defineProperty`
and no `enumerable: true`, so `Object.keys(window)`, the first thing Claude in Chrome tried, did not
list it. The meta tag is in `<head>`, which is neither in the accessibility tree nor in the page
text, and on the login page there was nothing at all. So Claude reported that the page had no API.
The API now announces itself on every channel an agent reads, and none of them carries more than
the page already shows. `window.alldone` is enumerable and exists in **every** state: `ready`, plus
`loading` / `signed_out` stubs that have no tools, make no request, explain themselves in `help()`
and resolve `whenReady()` with the real API once a session installs it. `BrowserAgentApiBridge` is
therefore mounted for the whole app in `AppContent` (`sessionReady` replaces the old mount
condition), and `resolveBrowserAgentPageState` decides the state. A user who switched browser
agents off gets **nothing**, not a stub, once their user document is known. During boot a loading
stub can appear briefly, because the account is not known yet.
`Object.keys(alldone.tools)` lists the tool names once `listTools()` has loaded them, and the proxy
only turns snake_case names into calls, so `then`, `toJSON` and `constructor` never call a tool.
There is one `console.info` line per page and state, and the loading stub stays silent. There is
also a JSON manifest, `<script type="application/json" id="alldone-agent-api">`, with the state,
usage and WebMCP outcome but no tool or user data, plus `data-alldone-agent-api-state` on `<html>`.
Native WebMCP is still off in production until origin-trial tokens are registered (see
`webMcpOriginTrial.js`).

**Every agent surface tells the agent that Alldone is the system of record (AT-2832).** Durable work
state and results go into Alldone objects (find and update the existing task or note, comment
progress and results on the task, longer results in a note or artifact, no duplicates, nothing for
throwaway steps) instead of living only in the agent's memory. The same guidance sits in four
places that cannot share code: `/llms.txt`, `SYSTEM_OF_RECORD_INSTRUCTIONS` / `_SUMMARY` in
`browserAgentApi.js` (`help()`, the stubs and the manifest's `systemOfRecord`; the summary names no
tools because the manifest never does), the `ai-agent-api` meta tag, and the MCP `initialize`
instructions (`functions/MCP/mcpAgentInstructions.js`). Keep them in step, and name only tools the
MCP server serves: `mcpServerSimple.test.js` checks every tool the MCP text mentions against
`tools/list`.

## The alldone.team specialists are assistant templates

Connor Consultant (Story Builder), Judy Job and Ricky Returns (Property Screener) are added to a
project like any template: "Add assistant" lists them in their own "alldone.team specialists"
section. They are not hand-made. `syncAlldoneTeamSpecialistsSecondGen` reads
`alldone.team/mcp/specialists` hourly (alldone.team publishes it from `CHAT_APPS`) and keeps one
template per specialist in `globalProject` under a fixed id (`alldone-team-<app>`), marked
`externalSource: { provider: 'alldone.team', appId, family, available, contentHash }`
(`functions/Assistants/alldoneTeamSpecialists.js`). The sync owns only what it derives from the
catalog (name, description, avatar, instructions, its MCP server entry, `externalSource`) and
writes only when that changed; model, tools and heartbeat stay the administrator's. A specialist
alldone.team stops offering is marked `available: false`, not deleted, so existing copies keep
working while the list stops offering it. Template changes reach project copies through
`templateSync` like every other template. Each specialist's tool pages (the catalog's `tools`: Connor's Story Planner
and Story Builder, Judy's Job Radar, Ricky's Property and Stock Screener) are kept as pre-configured
`iframe` tasks of the template (`assistantTasks/globalProject/preConfigTasks/alldone-team-<app>--<tool>`,
marked `externalSource`), so a person launches the tool from the assistant; the pages switch to embed
mode inside alldone.app by themselves. Adding the specialist copies them, `templateSync` carries
later changes and removals into existing copies, and tasks an administrator adds to the template by
hand are left alone. Only alldone.team URLs are accepted, because IframeModal hands the framed origin
the person's alldone.app token.

Each specialist's tools come from ONE managed MCP server entry: alldone.team/mcp with
`authType: 'alldone_app'`, so every call runs as the person talking to the assistant (their own
alldone.team data, their Gold per action) and no token is stored on the assistant, plus
`appIds: [family]`, so Connor sees only Story Builder's tools. `serverAllowsMcpTool`
(`functions/Assistant/mcpAppGroups.js`) applies that filter to assistant runs and to MCP app views
alike. The entry carries `managedBy: 'alldone.team'` (`functions/Assistants/managedMcpServers.js`):
it always follows the template in `templateSync` (a server a copy added next to it is kept and
never turns a template change into a review conflict), the connect/disconnect callables refuse to
touch it, and the MCP servers modal shows it without remove or on/off controls. Pinned by
`alldoneTeamSpecialists.test.js`, the specialist block of `templateSync.test.js`,
`mcpAppGroups.test.js`, `mcpAppViews.test.js`, `mcpAssistantConnect.test.js` and
`components/UIComponents/FloatModals/AddAssistantModal/specialistTemplates.test.js`.

## Goals, milestones and OKRs can be written by assistants and MCP clients (AT-53)

Five tools follow the create_task/update_task pattern: `create_goal`, `update_goal`,
`update_milestone`, `create_okr` and `update_okr`. Each is its own Tools Access key (default on, like
create_task) and its own switch under Settings → MCP. The logic lives in
`functions/Goals/goalToolService.js` and `functions/OKRs/okrToolService.js`. `executeToolNatively`
only resolves the project (named in the call, else the conversation's, else over MCP the user's
default) and returns a refused or ambiguous request as `success: false` with the candidates.
Existing assistants keep their stored `allowedTools`, so they get the keys only through their Tools
Access or `update_assistant` with `addTools`.

**A fixed milestone is not an object of its own; it is the date goals point to.** The app creates an
open milestone when a goal gets a completion date nobody uses yet and deletes it once no goal points
there. The tools do the same, which is why there is no `create_milestone`: a goal's `milestoneDate`
creates the milestone, and `update_milestone` renames it, moves it with its goals (merging when the
new day already has one), or marks it done or open through the same
`executeMilestoneDoneTransition` the app calls. A done milestone and an automatic (linear) one are
not moved.

**Days are matched by a window, never by timestamp equality.** The app stores a milestone at the
local noon of the browser that created it, while `users/{uid}.timezone` is often a stale integer
offset, so the noon the server computes can be an hour or two off. An equality match would give the
same day two milestones. The tools look for an open fixed milestone within half a day of the
computed noon, and the goal then takes that milestone's exact timestamp, because every reader
compares `completionMilestoneDate == milestone.date`.

Rules taken over from the app: moving a goal's milestone date moves the whole goal when it sat in
one milestone, came from someday or would otherwise start after it ends. Sort indexes are added for
every open milestone the goal now shows in. A private goal cannot gain an assignee here, because the
privacy cascade to its tasks, chat and note stays in the app. A goal or OKR create that finds the
same name (OKR: same label in the same period) returns the existing one with `alreadyExists`, so an
agent's retry does not duplicate it.

OKRs are personal, so the tools create them for the requester and refuse to change anybody else's.
A `timeLoggedRevenue` OKR computes its value from logged time, so setting one is refused. The goal
title and progress feeds existed only in the browser (`goalUpdates.js`); their server copies in
`Feeds/goalsFeeds.js` use the same feed types (81, 86) and texts.

`update_goal` takes a `comment`, alone or next to other changes, written by
`shared/objectCommentService.js` (see the next section). Pinned by `goalToolService.test.js`,
`okrToolService.test.js` (both on `functions/Tests/fakeFirestore.js`) and the `goal, milestone and
OKR tools` block in `assistantHelper.test.js`.

## Comments, deletes and sharing for contacts and artifacts over MCP

`update_goal`, `update_contact` and `update_artifact` take a `comment`, alone or next to other
changes. All three go through `shared/objectCommentService.js`, the counterpart of
`TaskCommentService` for other object types (one entry per type in `OBJECT_COMMENT_TYPES`). The
comment, the object's `commentsData`, the chat object and `followers/{p}/{type}/{id}` are written in
one transaction, then the unread markers, the email digest and the push follow. The object's own
people follow its thread: a goal's creator and assignees (never the `ws@` placeholder), a contact's
`recorderUserId`, an artifact's owner and creator. A private object notifies only the people in its
`isPublicFor`; when the field is missing the default is the one `mapContactData` and
`buildArtifactIsPublicFor` use (project plus recorder or owner). Use a null check rather than
`filter(Boolean)` for these defaults, because `FEED_PUBLIC_FOR_ALL` is 0. The notification rule is
update_task's: an assistant's comment is `silent`, and an MCP client's comment carries the marker and
notifies the user too. A comment that fails after other changes were saved becomes a warning; a
comment sent alone fails the call.

`delete_contact` and `delete_artifact` are separate Tools Access keys in `OPT_IN_ONLY_TOOLS`, so an
assistant deletes only after its owner switched that on; the `artifacts` toggle does not grant
`delete_artifact`. Over MCP each is its own switch under Settings → MCP. Both delete only the
document, as the app does: `onDeleteContactSecondGen` and `onDeleteArtifactSecondGen` remove the
thread, note, photos, versions, public link and backlinks. `delete_contact` takes an exact
`contactId` only, because update_contact's fuzzy name matching must never pick the person to delete,
and writes the app's "deleted relevant person" entry (ported to `Feeds/contactsFeeds.js`) before the
document goes, since the feed object is loaded from it. `get_contacts` takes `contactStatus` (id or
name, `none` for no status), applied before the limit.

`update_artifact` can also restore an earlier version (`restoreVersion`, not combined with new
content), change who sees it (`isPrivate`) and switch its public link (`publicLink: on|off|new`,
through `setArtifactPublicLink`). These follow the app: only the owner changes privacy (the chat
follows, and the update trigger withdraws the public link of an artifact made private), while any
member who can see the artifact may switch the link or delete it. A private artifact never gets a
link. Pinned by `shared/objectCommentService.test.js`, `Contacts/contactDeleteService.test.js`, the
contact status case in `ContactRetrievalService.test.js`, the `update_artifact beyond content` and
`delete_artifact` blocks in `artifactAssistant.test.js`, and the contact and artifact cases in
`assistantHelper.test.js`.

## Assistant Tool Checklist

When adding a new assistant tool, wire every layer, not just the backend schema:

- Define the schema in `functions/Assistant/toolSchemas.js` and add/adjust `functions/Assistant/toolSchemas.test.js`.
- Implement native execution in `functions/Assistant/assistantHelper.js`, including permission/runtime-context checks, conversation-safe results, and focused tests in `functions/Assistant/assistantHelper.test.js`.
- Add the tool to the assistant settings UI in `components/AssistantDetailedView/Customizations/ToolsAccess/toolOptions.js` so it can be enabled per assistant. Decide deliberately whether it belongs in `DEFAULT_ALLOWED_TOOLS` or `OPT_IN_ONLY_TOOLS`, then cover that in `toolOptions.test.js`.
- Add local strings for the tool label in `i18n/translations/en.json`, `de.json`, and `es.json`.
- Check channel-specific allowlists before assuming the tool is available everywhere. Gmail labeling follow-up only gets `GMAIL_POST_LABEL_SAFE_TOOLS` (`functions/Gmail/gmailPostLabelTools.js`); email replies and realtime/WhatsApp flows may have separate safe-tool filters or schema adapters.
- If prompts mention the tool, ensure the responsible assistant can actually enable it in Tools Access; otherwise the prompt can ask for an action the runtime will block.
- Offer it over MCP too (next section): add the name to `MCP_DELEGATED_ASSISTANT_TOOLS` in `functions/MCP/mcpServerSimple.js` and to `MCP_TOOL_KEYS` in `components/SettingsView/MCP/MCPSettings.js`, and make it work without an assistant. Leave it off MCP only with a reason in the list below.

## MCP and assistant tools offer the same features, on the same code

**Rule:** every capability an MCP client has, an assistant has, and the other way round, and both
run the same implementation. A tool that exists on one side only needs a written reason in the list
below; "nobody asked for it yet" is not one. Before adding or changing a tool on either side, check
the other side and do both in one change.

**How the code is shared.** An assistant tool runs in `executeToolNatively`
(`functions/Assistant/assistantHelper.js`), and MCP serves it through the same function with
`assistantId = null` (`MCP_DELEGATED_ASSISTANT_TOOLS`). A tool that started on MCP keeps its handler in
a module both sides call; `functions/Assistant/assistantTaskTools.js` is the pattern: one schema
definition (MCP gets it as is, assistants with `projectId`/`assistantId` optional and defaulting to
themselves), one handler (`mcpWorkspaceSetupTools.js`), one Tools Access key for assistants
(`assistant_tasks`), and an actor marker that says who acted (`via: 'mcp'` with the client, or
`via: 'assistant'` with the assistant). Three things to get right when a tool reaches the other side:

- **A check of the assistant's own Tools Access inside a tool** must let an assistant-less MCP call
  through, because the per-user switch under Settings → MCP already gated it
  (`assertAssistantOwnToolPermitted`).
- **"The current project" or "the current assistant"** means the thread's for an assistant; MCP falls
  back to the user's default project, which is a guess. Where a guess would write to the wrong place
  (`update_project_description`), MCP requires the project explicitly; the schema note is in
  `MCP_DESCRIPTION_NOTES`.
- **Authorship:** over MCP a write is the user's own, marked with the client (`getActorChannelFields`),
  never the assistant's. `add_chat_comment` shows the shape: user as author, no
  `lastAssistantCommentData` pointers.

**Where each capability lives (2026-11-09).** Shared modules, both surfaces:

- **Workspace setup and scheduled tasks** (`Assistant/workspaceToolsForAssistants.js`): MCP's
  `create_project`, `add_contact_statuses`, `create_assistant` (Tools Access key `workspace_setup`)
  and `create/get/update_assistant_task` (`assistant_tasks`) run the handlers in
  `mcpWorkspaceSetupTools.js` for an assistant too, defaulting to its own project and itself.
- **Assistant settings** (`Assistant/assistantSettingsService.js`): the assistant tool
  `update_assistant_settings` and MCP's `update_assistant` validate and save the same fields
  (name, description, instructions with history, model, temperature, voice, delegation description,
  project assistant) and pass changed instructions on to the scheduled tasks still on the old copy.
  **Tools Access is the one exception: only the user changes it (app or MCP), never an assistant,
  for itself or another** (`assertNoToolAccessFromAssistant`; `create_assistant` offers an assistant
  no `allowedTools`), so instructions hidden in an email or a web page cannot make an assistant grant
  itself new powers. `update_heartbeat_settings` is served over MCP for an assistant the client names.
- **Assistant pictures** (`Assistant/assistantPhoto.js`): `update_assistant`, `create_assistant` and
  `update_assistant_settings` take `photoUrl` (a public image URL; `""` removes the picture) or
  `photoArtifactId` (an image artifact the user can read, read through `readArtifactFileForUser`, the
  same reader as artifact mail attachments; the artifact tools themselves write text only, so an image
  artifact comes from an upload or a VM job). The server downloads the bytes, accepts only what its
  magic bytes say is JPEG, PNG, GIF or WebP (no SVG: it can carry script), at most 5 MB, and stores its
  own public copy at `assistants/{projectId}/{assistantId}/`, where the app's avatar upload puts it.
  Without an image library all three sizes (`photoURL`, `photoURL50`, `photoURL300`) get that one copy,
  as for contact photos, which is why the limit is half the contact one. The image is checked before
  any quota is spent and stored only once the write happens. Unlike the app's upload, no "changed
  picture" feed is written, the same as for every other `update_assistant` change.
- **VM jobs over MCP**: `execute_task_in_vm` and `get_vm_job` run as the **project assistant**
  (`MCP_TOOLS_RUN_BY_THE_PROJECT_ASSISTANT`), in a new task of that project; a project without an
  assistant gets an error that says how to set one.
- **Asking an assistant**: assistants have `talk_to_assistant`; MCP has `ask_assistant`
  (`MCP/mcpAskAssistant.js`). It posts the question as the user's comment in a task or topic thread
  with `assistantRunRequest` and starts the server-side run at once through the missed-run path
  (`enqueueMissedAssistantRunCheck` with `delaySeconds: 0`), so the run is the ordinary one: the
  assistant's model and tools, the user's Gold, the per-message run lock. It waits for that lock to
  settle (at most 120s) and returns the answer, or the thread and `waitForCommentId` to keep waiting.
- **Wiki documents**: `add_knowledge_document` takes a file of this conversation, a file of a thread
  the caller names (`threadObjectType`/`threadObjectId`, access-checked), an artifact (`artifactId`,
  its current version's text, if the user can read it) or `text`. The same tool on both surfaces.
- **Skills**: `load_skill` over MCP works on the project assistant (or a named one); without a name
  it lists the skills.

**One-sided on purpose:** `compact_thread_context` (an assistant's own thread context),
`external_tools` and `mcp_servers` (integrations configured on an assistant), `get_current_user_info`
and `delete_authentication_data` (MCP sign-in; an assistant already knows its user). `talk_to_assistant`
and `ask_assistant` are one capability with a different shape per surface.
