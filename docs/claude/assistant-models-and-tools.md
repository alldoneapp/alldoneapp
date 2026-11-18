# Assistant models, tool search, MCP app views and embed windows

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## In-app assistant models (chat, heartbeat, labeling)

`functions/Assistant/selectableAssistantModels.js` is the **one** product menu of assistant models,
and adding an entry there surfaces it in every picker at once: assistant model, heartbeat model,
inbound email, per-task override, Gmail labeling and calendar routing. Each selectable entry also
carries its actual in-app `tokensPerGold`; `assistantHelper.getTokensPerGold` reads that shared value
for billing, while `components/UIComponents/AssistantModelGoldRate.js` renders the same translated
`1 Gold = N tokens` line in every picker. Do not reuse the separate VM-agent divisor: the two product
paths can intentionally pass through different amounts of an upstream saving. Everything else is a per-capability
allowlist keyed on the product key (`MODEL_GPT5_6_SOL`, `MODEL_DEEPSEEK_V4_FLASH`), never on the
upstream id. Adding a model means setting `tokensPerGold` in the shared entry, then touching
`assistantHelper.js`'s `getModel`, `getMaxTokensForModel` and each `modelSupports*` gate, plus the label chains in `ModelWrapper.js` /
`assistantUpdates.js` / `UpdateFromTemplate.js` and the `i18n` label. **A model missing from
`getTokensPerGold` is billed nothing at all** — it returns `undefined` and
`calculateGoldCostFromTokens` turns that into `0`, silently.

**This is a separate system from the VM agent catalog** (`vmAgentModelCatalog.js` /
`vmModelRouting.js`). The VM harness encodes its provider into the model string
(`openrouter:vendor/model`) because the user picks from a live catalog of hundreds. The in-app
assistant does the opposite — a short curated list whose keys are already persisted on assistant
docs, Gmail configs and calendar configs — so the key stays opaque and the upstream id lives in a
table (`assistantModelRouting.js`). That is what lets the pinned DeepSeek release be bumped on one
line without a data migration.

**DeepSeek V4 Flash via OpenRouter (AT-2238)** is the first non-OpenAI, non-Perplexity assistant
model, pinned to `deepseek/deepseek-v4-flash-0731` rather than the floating
`~deepseek/deepseek-v4-flash-latest` alias, which would swap the model under live assistants and
labeling configs with no review. The load-bearing constraint is the **wire protocol**: chat and
heartbeats run on OpenAI's **Responses** API (`openai.responses.create`), and OpenRouter serves only
the OpenAI-_compatible_ **Chat Completions** surface — the same split `vmJobRunner` already handles
for Codex with `wire_api = "chat"`. So OpenRouter chat takes a second transport,
`openRouterChatClient.js`, which terminates at the _same_ stream contract
(`{content, additional_kwargs}` plus a trailing `tool_calls` event) so the tool loop, Gold metering
and progress status are untouched. Three consequences worth knowing: hosted **tool-search is
Responses-only**, so OpenRouter runs always send full function schemas (Flash's 1M window absorbs
it); `prompt_cache_key` / `prompt_cache_options` / `prompt_cache_breakpoint` are **OpenAI
extensions** and are omitted rather than sent hopefully; and Flash is **text-only**
(`input_modalities: ['text']`), so image parts are replaced with a readable placeholder instead of
failing the whole request. Modality is answered per model by
`assistantModelSupportsImageInput` in `assistantModelRouting.js` — it sits next to the pinned
upstream id because it is a fact about that release, and an unlisted OpenRouter model is assumed
text-only (a stripped image degrades to a note the model can explain; an image sent to a text-only
model takes the whole request down). The transport counts the replacements and warns, because a
dropped image is otherwise invisible: the request succeeds and the only symptom is an answer that
ignores the attachment the user is looking at.

**A chat image is fetchable, and `get_chat_attachment` used to say otherwise.** The tool and its
fallback filtered `media.kind === 'file'`, while WhatsApp and web uploads store a photo as
`kind: 'image'` — and `list_recent_chat_media` advertises those images together with their
messageIds. So the discovery tool named an image the fetch tool then denied existed
(`No file attachment was found on the requested chat message`), which is exactly the loop a
text-only model falls into when it cannot see an attached photo: it asked three times and burned a
minute of wall clock before answering. The bytes come from the same `storageUrl` whatever the kind,
so `isFetchableChatAttachment` now accepts `file`/`image`/`video`. The one thing widening the kinds
must not break is a message carrying an image **next to** a document: that used to resolve to the
document, so `selectRequestedChatAttachments` keeps that preference rather than turning a working
call into an ambiguity error, and an explicit `expectedFileName` outranks it. Base64 never enters
the conversation either way — `buildConversationSafeToolResult` redacts it. Labeling was the cheap half — the Gmail and calendar classifiers already
call `chat.completions.create`, so only the client swaps (`classifierModelClient.js`). Both
classifiers resolve their **two passes independently**, because a DeepSeek first pass with the
default OpenAI auditor is the normal configuration. Chat Gold rate is **2000 tokens/Gold** (Sol 100,
Terra 200, Luna 500) — a deliberate fraction of the ~80x upstream cost advantage, matching how
Luna's 25x is priced at 5x. Requires `OPENROUTER_API_KEY`, which **had never been whitelisted in
`envFunctionsHelper.js`** — that file builds explicit key objects rather than spreading the env
blob, so the key was `undefined` at runtime even when present in `GOOGLE_FUNCTIONS_ENV_DEV/_PROD`;
adding a secret to the blob is not enough, it must be listed there too.

Calendar routing additionally gained the model picker and the server-side allowlist it never had.
It previously accepted **any** string and defaulted client-side to `MODEL_GPT5_4_NANO`, a key
outside the selectable set that the classifier's mapper did not know — so it fell through to
`gpt-5.2`, and calendar labeling ran on a model that was neither stored nor chosen.

## Hosted tool search hides tools, and an unattended run cannot ask again

`buildResponsesTools` (`functions/Assistant/assistantHelper.js`) uses OpenAI's hosted **tool
search**: once a request carries `TOOL_SEARCH_MIN_FUNCTIONS` (10) or more function schemas on a
tool-search-capable model, **every** function is marked `defer_loading: true` and packed into
namespaces, and the model is sent only `{type: 'tool_search'}` plus the namespace descriptors. A
typical assistant therefore starts a turn with **zero directly callable functions** — 48 deferred
behind 10 namespaces is the ordinary case for the dogfooding account — and has to search for each
tool by name before it can call it.

That is a token optimization whose failure mode is a **silently wrong answer, not an error**. A
daily recurring task ("update my global user description") did every step of its work — eight model
rounds, `get_tasks` twice, `get_goals`, `get_notes`, `get_updates`, `get_contacts`, `get_chats`,
three minutes, 23 Gold — produced a correct new description, and then wrote _"I couldn't persist the
update because the available tools in this thread do not expose `update_user_description`."_ The
tool was in the assistant's `allowedTools` and in the assembled schema list for that exact request;
it sat in the `people_and_projects` namespace, the same one the run had already pulled `get_contacts`
out of. The model simply never searched for it, and a model that concludes a tool is missing does
not retry. Nothing failed, nothing was logged as an error, the task was marked done and the Gold was
spent. The same task on the same model succeeded on each of the three preceding days.

Three rules come out of that, and they are independent:

**A tool the prompt names in writing is never deferred.** `addBaseInstructions` injects lines like
_"use `update_user_description`"_, and an assistant's own `instructions` name their tools too — so
the model is told by name that a tool exists while the schema for it is hidden. `interactWithChatStream`
runs `collectPromptReferencedToolNames` over the **system** messages and passes the hits to
`buildResponsesTools` as `alwaysDirectToolNames`; those go out as ordinary direct tools and the rest
still defer. Scanning is deliberately limited to system messages — they hold our base instructions
and the assistant's configured instructions, whereas a tool name in a user turn or a tool result is
conversational noise that would pin schemas for the whole thread. Matching is longest-name-first, so
`web_search` is never reported as a bare `search`.

**`execute_task_in_vm` is never deferred either, named or not (AT-2842).** No system message names
it, so the rule above never pinned it, and the namespace it landed in (`tasks_and_goals`) mentions
only "execution jobs". Asked in a task thread to check a deploy and run a migration, the Alldone CTO
(tool enabled, GitLab repo connected) answered in one round, without a tool search, that it had no
access to a VM, GitLab or a deployment console, and told the user to use "the VM-capable session of
this task", which did not exist. It never saw the tool's own description, which says to use it for any
coding or repository work. The thread made it worse: the status comments a coding agent had posted
through MCP sit in the context as **user** turns and talk about "the other session". So
`NEVER_DEFERRED_TOOL_NAMES` in `assistantHelper.js` is merged into `alwaysDirectToolNames` inside
`buildResponsesTools` for every caller. It changes nothing for an assistant without the tool, since
only schemas already in the request can be sent directly. Add a tool there only when its absence
makes the model explain instead of search; every entry costs a full schema in every request that
carries it. Pinned by the `execute_task_in_vm is never deferred` block in `assistantHelper.test.js`.

**An unattended run turns tool search off entirely.** Tool search trades a retry for a smaller
prompt, and an interactive user simply asks again — but nobody is watching a recurring task, a
heartbeat or a workflow AI step, so there the trade is all cost. `generatePreConfigTaskResult` takes
`options.disableToolSearch`, and all four unattended call sites set it: `assistantRecurringTasks`,
both `assistantHeartbeat` sites, and `workflowAiStep`. The workflow step is the worst of them to get
wrong — it **hands the task to the next reviewer when it finishes**, so a step that reported a tool
as unavailable would advance the task anyway and carry the non-answer down the chain. The two
interactive entry points (`generatePreConfigTaskResultSecondGen`) keep tool search.

**Prefixed tool families are namespaced BEFORE the keyword rules.** `getToolSearchNamespaceName`'s
keyword tests used to run first, and `talk_to_assistant_*` / `external_tool_*` / `mcp_*` names are
built out of user-authored project and assistant names — so `/assistant/` swallowed every delegation
tool into `assistant_settings` ("Manage assistant settings, memory, heartbeat behavior, skills, and
thread context"), a delegate in a project called _MediAgents_ matched `/media/` and landed in
`chats_and_media`, and the `integrations` namespace was unreachable dead code. Advertising a
delegation tool under "assistant settings" is exactly what makes tool search miss it, and the
overflow also pushed the real settings tools into an `assistant_settings_2` chunk. The prefix test
now runs first.

**MCP tools are grouped by app, and only what a run needs reaches the model (`Assistant/mcpAppGroups.js`).**
`getReachableMcpTools` used to keep the first 60 tools of all MCP servers together and drop the rest
silently. alldone.team/mcp serves Story Builder (66 tools), Judy (50) and Property Screener (17) over
one connection, ~40k tokens of schemas, so Judy and Property never reached the assistant. Each tool now
carries its app: a server may name it in `_meta['team.alldone/app'] = { id, name, summary }`, and a tool
without it belongs to its server. With hosted tool search every app is a namespace of its own
(`mcp_judy_job`, described by the app's summary) instead of all MCP tools sharing `integrations`. Without
tool search (OpenRouter models, unattended runs) a server with up to `MCP_DIRECT_TOOL_LIMIT` (30) tools is
still sent whole; above that the model only gets `open_mcp_app`, which lists the apps, and opening one
adds its tools from the next step of the same run on (`openedMcpAppKeys` on the run's tool runtime
context). `open_mcp_app` is allowed by the `mcp_servers` toggle. The dynamic tool cache stores the apps
next to the schemas (`mcpApps`); an entry without them is rebuilt. Pinned by
`Assistant/mcpAppGroups.test.js` and the `MCP tools grouped by app` block of `assistantHelper.test.js`.

**MCP Apps views appear under the assistant's answer (`MCP/mcpAppViews.js`, `McpAppViews.js`).**
A tool may declare a view (`_meta.ui.resourceUri = 'ui://…'`, MCP Apps / SEP-1865); alldone.team's
`judy_show` does. When a run calls such a tool, the executor records `mcpAppViews/{viewId}` (server-written,
readable only by `userId`, the person the run acted for) under `assistantCommentId`. A view is NEVER
shown inline in the chat: below that comment (`MessageItemBody`, `CommentsList`) there is only a
one-line card, and the view opens in Anna's right pane or, outside the assistant shell, in a window
that fills the screen apart from a slim header (`McpAppModal`, mounted with the global modals,
`mcpAppModalStore`). The frame gets the server's HTML in
`srcdoc` with `sandbox` WITHOUT `allow-same-origin`, so it runs on an opaque origin and can reach
neither the app's storage nor its session; its own CSP from `_meta.ui.csp` is put first in `<head>`
(`mcpAppHost.js`), and the app page's CSP applies on top. That is why no separate sandbox domain is
needed, unlike artifacts, whose bytes are served from a URL. The frame never holds a token: its
`tools/call` and the resource itself go through `mcpAppSecondGen` with the view id, which re-checks
the person, current project membership, that the server is still on the assistant, and that the tool
lets the app call it (`visibility` includes `app`); the call uses the same `resolveMcpSecret` as the
run, so a view can do no more than that person's own assistant. A tool whose `visibility` leaves out
`model` (e.g. `judy_view_get`) is never offered to or run for the model. The view always runs in
fullscreen display mode and fills its container. In Anna's assistant shell the view opens in the RIGHT PANE (`AnnaAppPaneContext`, surface `app:<viewId>` in `AnnaShell`, listed in the workspace picker),
and the chat keeps a one-line card that reopens it. A view recorded in the last two minutes opens by
itself once (on a phone without leaving the chat); an older one, met by scrolling back, only offers
to; the same rule opens the embed window outside the shell. Pane views stay mounted while hidden, up
to five, so switching panes keeps their state. Three rules came from one run on 2026-11-03 that left
Judy closed with two cards under the answer. **The cards are watched while the answer is still
being written** (`MessageItemBody` renders `McpAppViews` outside its loading branch, one element
in both states): the freshness clock starts at the tool call, and the run kept working for five
minutes, so cards that mounted only once the answer was done found every view stale. **One card and
one pane per app** (`mcpAppKey`: same server, same `ui://` resource): `judy_show` ran twice in that
run and each call records its own view; the newest supersedes the others. **An open app view is
protected like a VM view**: the reveal of a saved object waits, `show_workspace` becomes the
"would like to show you" notice, and the browser is not followed. In that run the assistant created
a task to track its own work and showed it, which would have replaced Judy two minutes after it
opened. A view's own "Show in chat" button sends `ui/request-display-mode` with `inline`; the host
answers `fullscreen` and closes the pane (Alldone shows again) or the embed window. Pinned by
`MCP/mcpAppViews.test.js`,
`mcpAppHost.test.js`, the view-only case in `assistantHelper.test.js` and the `MCP Apps views` block
of the rules emulator suite.

**Both embed windows hand their app to that pane (AT-2951).** The windows (`IframeModal` for
pre-configured iframe tasks such as the alldone.team tool pages, and `McpAppModal`) are mounted
with the global modals in `AppContent`, outside `AnnaShell`'s tree, so no context reaches them:
`AnnaShell` registers its `openAppView` and whether assistant mode is open in
`components/Anna/annaAppPaneBridge.js`. Each window's header starts with the top bar's
assistant-mode icon (`OpenInAssistantPaneButton`), which switches to split mode with the app in the
right pane; and a window opened while assistant mode is on never paints at all, it hands the app
over in a layout effect (so does an MCP card in a chat inside the Alldone workspace). An iframe app
is a pane view `{ kind: 'iframe', viewId: 'iframe:<url>', url, appName }` rendered by
`EmbeddedAppFrame`, the frame and postMessage protocol (user data, alldone.team token, Gold,
roadmap) extracted from `IframeModal` so both hosts speak it identically. Moving an app reloads its
frame: a live session inside it (screen share, unsaved state in the third-party page) does not move
with it. The way back goes through the same bridge: leaving assistant mode (the chat's X, the top
bar or sidebar toggle, browser Back) while an app is on screen in the pane reopens it in its window
(`registerEmbedWindow('iframe' | 'mcp')`, `openInEmbedWindow`) and closes the pane's copy, so it
never runs twice. Only the pane's selected app comes back, from chat-only mode too, where the pane
is merely hidden (product decision): not with Alldone selected, not an app only listed in the
picker, and not through the Home button (which means the task list) or choosing Alldone in the
phone's picker (which leaves assistant mode by design). The shell hands back from a layout effect
declared after its bridge registration, so the window already sees assistant mode as off and does
not send the app straight back. Pinned by `IframeModal/embedWindowAssistantPane.test.js` and the
two AT-2951 blocks of `AnnaShell.test.js`.

**Both embed windows share one layout and close on a backdrop click (AT-2953).**
`IframeModal/embedWindowLayout.js` makes `IframeModal` and `McpAppModal` the same card: the viewport
minus one uniform `MODAL_EDGE_GAP` (16px) on every edge, applied as the safe-area overlay minimum
(`max(gap, inset)`). There is no percentage and no max size, so no extra margin on big screens.
Below `MODAL_SHEET_BREAKPOINT` the gap is 0 and the window is full screen. A click on the backdrop
closes the window, by product decision, although a live session in the app (screen share) goes with
it. `useBackdropDismiss` counts only a press that both starts and ends on the backdrop. This
excludes a drag out of the card and the click that opened the window (its pointerdown predates the
backdrop). Clicks inside the cross-origin frame never reach the document. Phones have no backdrop
dismissal: the only uncovered strips there are the safe-area insets. Pinned by
`IframeModal/embedWindowLayout.test.js`.

**A view outlives the connection it opened with, and is reconnected only on a click (AT-2952).**
"This app is no longer connected to the assistant." meant exactly that: on 2026-11-03 the user had
removed alldone.team from Anna's MCP servers in the morning, and the Judy pane reopened that
afternoon pointed at a server id the assistant no longer had. It was not a session expiry. A view now
keeps its server's non-secret address (`serverUrl`, `serverTransport`, `serverAuthType`) and finds
its server by id, then by that address with the same sign-in on the SAME assistant (a server removed
and added again gets a new id), then, for views recorded before the address was kept, by the only
server with the same label (and stores the address it learnt). When the assistant no longer has it,
`mcpAppSecondGen` fails with `details.reason: 'server_disconnected'` and the pane shows
"Connect again", which calls `action: 'reconnect'`: an ordinary `connectAssistantMcpServer` under
the view's original id, by somebody allowed to edit the assistant, validated by listing tools as that
person, idempotent if the server is already back. It is offered only for servers that need no stored
secret (`none`, `alldone_app`); bearer/OAuth servers and views with no known address point to the MCP
settings. Never reconnect without the click: removing a server is a deliberate choice. Pinned by the
AT-2952 blocks of `MCP/mcpAppViews.test.js` and `McpAppViews.test.js`.

**`generatePreConfigTaskResult` reads run options from its 13th parameter, never from `taskMetadata`
(the 10th).** The two bags look interchangeable at a call site and one of them is silently ignored:
`assistantRecurringTasks` had been passing `maxRunWallClockMs: SCHEDULED_PROMPT_MAX_RUN_WALL_CLOCK_MS`
(25 min) in the metadata bag, so every scheduled run in production reported the 55-minute interactive
default while `checkRecurringAssistantTasks` is deployed with `SCHEDULED_FUNCTION_TIMEOUT_SECONDS`,
sized for 25. The run's own guardrail could therefore never fire first — and per the note in
`assistantRunLimits.js` a scheduled run past the Cloud Scheduler attempt deadline is not truncated,
it gets a **second concurrent invocation of the same function**. `warnAboutMisplacedRunOptions` now
names the mistake at runtime instead of swallowing it. Pinned by the tool-search blocks in
`functions/Assistant/assistantHelper.test.js` and
`functions/Assistant/assistantPreConfigTaskTopic.test.js`.
