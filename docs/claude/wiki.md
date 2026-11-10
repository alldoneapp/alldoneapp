# Project wiki (knowledge base)

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## The project wiki is compiled only from what the whole project can see

`knowledgeBases/{projectId}` holds a Karpathy-style wiki per project: Markdown pages a model compiles
from the project's tasks, goals, notes, contacts, comment threads and artifacts (`functions/KnowledgeBase/`, read UI in
`components/WikiView/`). Members may read the whole tree straight from Firestore and nobody may
write it; every write is a callable or the `runKnowledgeBaseIngest` worker. The member who switches
it on pays (`knowledge_base_ingest` Gold, monthly cap, default model DeepSeek V4 Flash).

**It is on by default for every project of an active user, and a run spends nothing on a payer who
is away.** "Active" is the heartbeat rule (a login within `ACTIVE_USER_WINDOW_MS`, 30 days), imported
through `knowledgeBaseSchedule.js` rather than re-declared. `knowledgeBaseDefaults.js` writes the
default as a real document (`enabledBy: 'default'`, first run at the payer's next 03:00) for a
project that has **no** `knowledgeBases/{projectId}` document at all; an existing document is a
decision and is never switched back on. Three callers reach it: `onCreateProject`, the user trigger
when somebody logs in after 30 days away, and the daily `applyKnowledgeBaseDefaults` sweep, which is
also what reached the projects that existed before the default — there is no migration. The payer
is the project's creator when they are an active member, otherwise the member being processed.
Guides (`parentTemplateId`) and templates are excluded on purpose: a guide's `creatorId` is the
template's author, who would otherwise pay for the wiki of every guide anybody starts. **Archived
projects get the wiki too (AT-2893)**: archiving (`users/{uid}.archivedProjectIds`, per member) means
"done with this project", not "forget what we learned in it", and the wiki is what keeps a past
project's knowledge usable in search, `read_knowledge_page`/`search_knowledge` and global search
(which includes archived projects by default, AT-2524). An archived project is built and kept current
by the same nightly run, with the same payer rules and the same 500-Gold monthly cap; once caught up
it costs no Gold, because a run that finds no changed source makes no model call. The sweep orders a
member's archived projects after the active ones, so `MAX_PROJECTS_PER_USER` cuts past projects
first. (`project.active === false` is a different, project-wide flag — no member opened it in 30
days — and stays excluded.) Until AT-2893 a member who archived a project neither switched its wiki on
nor paid for it, and a run stopped with `project_archived` and cleared `nextRunAt`. No run writes that
reason any more; `isKnowledgeBasePausedForArchivedProject` only recognises the leftover state, which
the sweep and a save in the settings resume like `owner_inactive`. When the
payer has been away 30 days the run stops with `owner_inactive` and clears `nextRunAt` (paused, no
model call); the payer's return resumes it, and a wiki the default switched on moves to another
active member once its payer is gone. A wiki a member switched on themselves (`enabledBy: 'member'`,
or no field on wikis that predate the default) never changes hands that way — it waits. Note
`releaseIngestLease` must not `Math.min` a null `nextRunAt` (it is `0`, i.e. due forever). Pinned by
`knowledgeBaseDefaults.test.js` and the `owner_inactive` and archived-project cases in
`knowledgeBaseIngest.test.js`.

**A wiki that reaches its monthly Gold limit says so, and raising the limit resumes it.** The run
stops with `monthly_cap` and schedules itself for the first of next month (UTC); before this, that
was visible only on the wiki document, and two production wikis stood still unnoticed on their
first build. `knowledgeBaseCapNotice.js` now has the project's assistant open a topic of its own
(`WikiGoldCap_<projectId>_<month>`, private to the payer, unread badge, MyDay assistant line) with a
link to `/project/<id>/wiki-settings`. The message is fixed text in the payer's language, not a
model answer: a notice that the Gold ran out must not spend Gold. It is sent once per wiki, month
and limit (the comment id carries the limit), and it never throws into the run. Raising the limit
above this month's spending in the settings sets `nextRunAt` to now and enqueues a run
(`cap_raised`); otherwise the notice would send people to a setting that changed nothing until the
1st. The wiki view and the settings show the pause too (`isKnowledgeBasePausedAtMonthlyCap`). A cap raised WHILE a run is going is not a pause yet, so that save resumes nothing: the run therefore re-reads the stored cap before it stops for it, and `releaseIngestLease` re-checks the stop against the cap stored at release and reschedules at once instead of pausing (AT-2880, a run that had read 5000 paused a wiki already raised to 10000 until the 1st). A wiki left paused at a cap already above its spending can be resumed by saving that same cap; the settings offer it.
Pinned by `knowledgeBaseCapNotice.test.js`, the monthly-cap cases in `knowledgeBaseIngest.test.js`
and `knowledgeBaseSettings.test.js`.

The wiki view is one column on every screen: the index (each page with its own "last updated"),
then a page in its place with a back link. The line above the index is the wiki's last run, not a
page's. "Give feedback" at the top of a page opens the same assistant topic the old footer link
"Suggest a correction" did (`WikiCorrectionForm`); the assistant applies it with
`correct_knowledge_page`.

**The ingest runs through the Admin SDK, so the visibility filter is the ONLY protection.**
`isVisibleToWholeProject` in `collectKnowledgeSources.js` admits an object only when `isPublicFor`
names `0` and it is not `isPrivate` (goals without `isPublicFor` count as public, matching
`mapGoalData`); emails, generated day-rate tasks and user-memory notes are excluded outright, and
contact email addresses and phone numbers never reach a source card. `loadSourcesByKeys` re-applies
the same filter, because a key stored on a page is not proof the object is still public.

**A comment thread is exactly as visible as the object it belongs to, never as its chat object
says.** Threads are sources of their own (`[[chat:ID]]`, the chat object's id, which for a task,
note, goal, contact or artifact thread is that object's id). The delta finds them with one query on
`chatObjects/{projectId}/chats` by `lastEditionDate` (every new comment stamps it), then reads each
thread's object and filters it like a source: a private task's thread is never read, and the thread of
an email task or a time-log task is excluded with it. A chat object copies `isPublicFor` once at
creation and is not kept in step with its object, so trusting it would leak. A topic is its own
object. Threads of users, assistants and skills are not sources, nor are the wiki's own Gold notice
(`WikiGoldCap_…`) and comments still being written (`isLoading`/`isThinking`). A member's daily
WhatsApp (`BotChat…`), email (`BotChatEmail…`, and the "Daily emails …" topics of the Gmail
labeling, whose comments carry `gmailData`), heartbeat and menubar topics ARE sources by decision
(they are readable by the project anyway, and things worth knowing get discussed there); the ingest
prompt tells the model to keep only what concerns the project and nothing personal. Tasks created
from an email (`gmailData` naming a `messageId`/`messageIds`: Gmail labeling follow-ups, the email
line's "create task") and their threads ARE sources too since AT-2833, behind the same visibility
filter as every other task and nothing more; their card says "created from an email" and carries no
mailbox, address or link. Only the daily inbox counter (`isForEmail`, "Emails in inbox", an unread
count) stays out, as `email_inbox` (`isInboxSummaryEmailTask`). A delta card carries only the comments since the wiki last
looked (comments `created >=` the chats cursor), at most 40 and about 6,000 characters, newest kept;
a rebuild reads the latest ones. Two known limits: an edited comment does not stamp the chat object,
so an edit is only seen when the thread changes again, and an object made public again does not
bring its older comments back until somebody comments. **Artifacts** (`[[artifact:ID]]`) contribute
title, description and the text of the current entry file (`knowledgeArtifactText.js`: text kinds as
text, HTML as visible text, PDF/Word/PowerPoint/Excel through the upload extraction; images, audio
and video never, because transcription costs money on every edit). Withdrawal: an object's
update/delete trigger withdraws `type:ID` and `chat:ID` together, the artifact triggers do the same,
and `onUpdateChatSecondGen`/`onDeleteChatSecondGen` withdraw a topic made private and any deleted
thread. Pinned by the `comment threads and artifacts` blocks of `collectKnowledgeSources.test.js`
and `knowledgeSourceInvalidation.test.js`, `knowledgeArtifactText.test.js` and `components/WikiView/wikiLinks.test.js`.

**A withdrawn source must leave the stored data, not just the views.** When a cited object turns
private or is deleted, the object's existing update/delete trigger calls
`knowledgeSourceInvalidation.js`, which marks the citing pages `needsRebuild` (hidden from people
and assistants) AND deletes their title, summary, body and the source's label, and strips the text
from every revision that cited it (`redacted: true`) — found through `historicalSourceKeys`, since a
page can stop citing a source after an older revision repeated it. Hiding alone would leave the text
one Firestore read away. The rebuild then recompiles the page from its REMAINING sources without
ever showing the model the old text; `read_page` reads fresh and never returns a hidden page, not
even to the run rebuilding it. Only the page id (its slug) survives. Pinned by
`knowledgeSourceInvalidation.test.js` (the `removing what a withdrawn source contributed` block) and
the read_page cases in `knowledgeBaseIngest.test.js`.

**Assistants read it, and a member corrects it through them** (`knowledgeBaseAssistant.js`). The
index of visible pages goes into the system prompt right after the project description, and the
wiki tools have no Tools Access toggle, like `load_skill` — the wiki itself is the access control:
`read_knowledge_page` and `search_knowledge` for every member run, `correct_knowledge_page` and
`undo_knowledge_correction` for runs that may correct, plus the document and saved-knowledge tools
(`add/remove_knowledge_document`, `save/remove_knowledge_contribution`) once the wiki is on.
`resolveKnowledgeBaseAccess` decides per run, and the same answer drives the prompt, the offered
tools and the execution gate:

- **nothing** without an assistant and a requesting user who is a member of the project, nothing on
  the email channel (action-only, may reply outside the project) and nothing to Gmail labeling;
- **reading** everywhere else, and in writing mode;
- **correcting only when `allowKnowledgeCorrections` is set**, by the runs that answer a member
  whom the channel itself verified: the in-app chat (`assistantNormalTalk_optimized`), WhatsApp
  messages (`whatsAppAssistantBridge`) and in-app or WhatsApp voice calls (`assistantLiveBackend`,
  via `canCorrectKnowledgeBaseOnChannel`). A phone call over the public network is matched to an
  account by caller ID alone, which can be forged, so it only reads. A heartbeat, recurring task
  or delegated assistant is not a member saying "this is wrong". Neither is an **automatic comment reply**
  (`runAssistantCommentReply`, answering another assistant's comment such as a Gmail follow-up):
  `askToOpenAIBot` derives `allowKnowledgeCorrections` from `!runOptions.automaticCommentReply`, and
  `resolveKnowledgeBaseAccess` returns read-only for `automaticCommentReply` whatever the flag says
  (security audit NV-45).
- **MCP clients read and correct too** (Claude, Codex, any agent signed in to the Alldone MCP
  server through OAuth). They are the one caller with no assistant, so `resolveKnowledgeBaseAccess`
  answers them by `sourceChannel === 'mcp'`, which only the MCP server's own runtime context sets,
  and membership is still checked per call. Each wiki tool served there (read, search, correct,
  undo, save and remove saved knowledge) is a separate switch under Settings → MCP
  (`mcpDisabledTools`), so correcting can be switched off while reading stays on. Over MCP
  there is no page index in a prompt and no conversation project: `read_knowledge_page` without a
  slug lists the pages, `projectId` defaults to the user's default project, and
  `adaptToolSchemaForMcp` in `mcpServerSimple.js` rewrites exactly those parts of the shared
  descriptions. A correction made this way records `sourceChannel: 'mcp'` and `assistantId: null`.
  `__tests__/SettingsView/MCPSettingsToolParity.test.js` fails the build when the server serves a
  tool that Settings → MCP cannot switch off, or when Settings lists a tool the server does not
  serve; every MCP tool, the six `browser_*` tools included, is its own switch there.

A correction is stored in `knowledgeBases/{id}/corrections/{id}` in the SAME transaction as the
page revision it produced (`writeKnowledgePage`'s `onWrite`), is cited as `[[correction:ID]]`
(the model writes `[[correction:new]]`), and overrides older sources in every later ingest prompt.
Undo (tool, or the wiki history's button through the `undoKnowledgeCorrection` callable) restores
the revision before it via `restoreKnowledgePageRevision` — only while the page is still at the
correction's revision, never from a `redacted` revision — and marks it `reverted`, after which
neither the ingest prompts nor `loadKnowledgeSourcesByKeys` use it. The "Suggest a correction"
button on a page only opens a chat with the project's assistant (`createBotQuickTopic`); it never
writes the wiki itself. Pinned by `knowledgeBaseAssistant.test.js` and the `project wiki wiring`
block in `assistantHelper.test.js`.

**A page is the current state, never its history.** The revisions already keep every past version
of a page, so `WIKI_RULES` in `knowledgeBaseIngest.js` forbids narrating how the project got there
(meeting chronology, "first …, then …"), tells the model to replace a superseded statement and its
citation instead of adding the new one beside it, and allows alternatives only while a question is
still undecided: once decided, the decision and its reason stay and the rejected options go. Both
ingest modes list source cards oldest first, so a later card wins a disagreement; the rebuild path
sorts them itself because `loadKnowledgeSourcesByKeys` returns them in page order. The
`correct_knowledge_page` body follows the same rule. Pinned by the `current state` case in
`knowledgeBaseIngest.test.js`.

An ingest run only rewrites a page when one of its sources changes, so pages written before these
rules keep their history until a **one-time current-state pass** reaches them
(`knowledgeCurrentStateRewrite.js`, requested by `migration/rewriteKnowledgeBasesToCurrentState.js`
after `runKnowledgeBaseIngest` is deployed; dry run by default). The request is only a list of slugs
on the wiki document (`currentStateRewrite.pendingSlugs`) plus making the wiki due; the run works
through it after its rebuilds and before the delta, at most `MAX_CURRENT_STATE_REWRITES_PER_RUN`
conversations per run, each from the page's own text plus the cards of the sources it cites, billed
to the owner and stopped by the monthly cap like any other run. Three details: the store sees the
rewrite as an ordinary `ingest` edit (it read the page first and keeps its `sourceKeys`; only a
rebuild replaces them), so neither the store nor the Updates feed needs a new mode (the feed lists
it as an update, badged like any change the wiki makes itself); a page this run has
just rebuilt is skipped (`lastRunId`), and a page that is archived, hidden or has no readable source
leaves the list without a model call; and a run stopped mid-conversation leaves that slug
pending, so the page is rewritten by the next run rather than skipped. Pinned by
`knowledgeCurrentStateRewrite.test.js` and the `one-time current-state pass` block of
`knowledgeBaseIngest.test.js`.

**Every page revision is a line in the Updates feed, and the line carries no page text.**
`onCreateKnowledgePageRevisionSecondGen` (`KnowledgeBase/knowledgeWikiFeed.js`) turns each new
revision — ingest, rebuild, archive, correction, undo — into one feed entry under ONE feed object
per project and day (objectId and type `wiki`, never the project id: `projectsFeeds` is keyed by
object id alone and the project's own object lives there). The entry stores `wikiSlug`,
`wikiRevision` and `wikiChange` and nothing else of the page — no title, summary or reason —
because a withdrawn source is removed from the page and its revisions by
`knowledgeSourceInvalidation.js`, and nothing would remove a copy from `feedsStore`, the followed
stores, `feedsCount`, `projectsFeeds` and the activity summary. The client reads the title of that
revision for the line (`useWikiFeedPageTitle`, falling back to the slug) and the diff from the
revisions themselves. A change a member made (correction, undo) badges the other members with its
own line. The wiki's own changes (ingest, rebuild, archive, lint) badge every member ONCE per
project and UTC day, through one shared counter key, `wiki_automatic` (AT-2967). They used to badge
nobody, and that made them invisible: Updates opens on the unread lines alone whenever anything is
unread, and a 03:00 line sits below the whole day otherwise (All Projects shows 5 per project), so
nobody ever saw one. One counter line per revision would be the opposite trap: `feedsCount` is
copied verbatim into each member's single `activityUnreadSummary` document across all projects,
and archived projects keep their wiki running with counters nobody clears, so that document would
grow every night without bound. The trigger reads the slot first, and a slot already holding this
day's change makes later revisions write no counter at all. A failed read writes the slot anyway,
which is safe because the key is fixed. The card also says what the wiki cost on its day, with a
link to the wiki settings (`components/Feeds/FeedsObjects/wikiDayCost.js`): the `goldSpent` of the
runs that worked during that local day, read from `knowledgeBases/{id}/runs` (members may read the
tree) with one query per card and day. Per day and not per line, because one run rewrites many
pages and a cost on every line would add up to many times what was spent; a running run counts
as "still going" until it writes its total. Each page row of the collapsed card leads with the time of that
page's newest revision of the day (the one the row opens), formatted like every other feed line: local
time, `getTimeFormatForDateFormat(state.dateFormat)` (AT-3006). Member corrections are not runs, since their model
calls are billed to the chat they came from. Ids are derived from slug + revision, so a redelivered
trigger rewrites the same documents. A line opens `/projects/{id}/wiki/{slug}/changes/{revision}`
(`WikiPageChange`, diff in `wikiDiff.js`: LCS over lines, word highlights inside an edited line,
folded context), which also works for archived and hidden pages because it reads revisions, not
the visible page list, and shows a redacted revision as removed and nothing more. Revisions record
`created` so a new page reads "created", not "updated". Pinned by
`knowledgeWikiFeed.test.js` (including that no page text reaches any feed document),
`components/WikiView/wikiDiff.test.js`, the `what a revision changed` block of `WikiView.test.js`
and `components/Feeds/FeedsObjects/WikiObject.test.js`.

**A wiki run that loses its model connection retries within minutes, not overnight (AT-2870).**
On 2026-10-26 one OpenRouter stream broke off with `Network connection lost.` and paused a wiki
that was catching up until the next night. OpenRouter reports a lost upstream connection as an
error event INSIDE an HTTP 200 stream, which the OpenAI SDK throws as an `APIError` with no
`status` and `code: 502`; the SDK's own create-time retries never see it. `streamOpenRouterChat`
therefore re-requests a transiently broken stream twice (`Assistant/transientModelErrors.js`
decides what is transient), but only while the consumer has received nothing of it: interactive
text that already reached the user is never replayed. The ingest passes `bufferModelOutput`, so
its answers are held back until complete and can be retried at any point; tool calls are emitted
only by a completed stream either way. A run that still fails transiently schedules itself 7
minutes later and enqueues that task itself (the dispatcher only ticks every 15 minutes), at most
`MAX_TRANSIENT_FAILURE_RETRIES` (3) times in a row; anything else keeps the nightly slot. Pinned by
the AT-2870 blocks in `knowledgeBaseIngest.test.js` and `openRouterChatClient.test.js`, and by
`transientModelErrors.test.js`, which builds the SDK's real error classes.

**The project description frames the wiki and is never one of its sources.** The two have
separate jobs. The description (`projects/{id}.description`) is a short, stable profile written by
people: what the project is, what belongs in it, standing rules. Task, calendar and Gmail routing,
the email channel, VM jobs and projects without a wiki depend on it. The wiki holds everything that
changes. Every ingest conversation therefore gets the description, capped at
`PROJECT_DESCRIPTION_MAX_CHARS`, to judge scope and framing. It may never
be cited or copied onto a page. It is free text written without a visibility filter and has no
source key, so `knowledgeSourceInvalidation.js` could never take a copied statement back out.
`update_project_description` and its base instruction steer assistants the same way: status
and recent activity stay out of the description unless the user explicitly asks for them.

**A member can hand the wiki a document: "put this deck into the wiki" (AT-2816).** The runs that
may correct also get `add_knowledge_document` and `remove_knowledge_document`
(`knowledgeDocuments.js`), offered as soon as the wiki is switched ON, not only once it has a page,
because a deck is often the first thing a new wiki gets. The model passes no content: the server
reads the uploaded file of THIS conversation (`readChatAttachmentFile`, the same resolution as
`get_chat_attachment`), extracts up to 120,000 characters and stores them at
`knowledgeBases/{id}/documents/{id}`, then pulls `nextRunAt` to now and enqueues a run. The ingest
reads documents as a source type of their own, cited `[[document:ID]]`, with a rule to work the document
into the pages it concerns rather than write a summary page next to them. Four things are
load-bearing. A long document is split into parts of at most `DOCUMENT_PART_MAX_TOKENS` (10,000)
because `chunkKnowledgeSources` CUTS an oversized card instead of splitting it — a deck would
otherwise lose everything after its first ~55,000 characters, silently. Only the LAST part carries
the cursor position, so a run that stops after part 2 of 4 reads the whole document again rather
than never seeing parts 3 and 4. A document is not a note on purpose: it lives inside the wiki tree,
shares its audience by construction (like a correction), and never shows up in notes lists or
follower notifications; only the page revisions it causes reach the Updates feed, like any other
wiki change. The current-state pass and rebuilds load all its parts through
`loadKnowledgeSourcesByKeys`. And removal runs the same `invalidateKnowledgeSource` as an object that
turned private — pages emptied, hidden and rebuilt, revisions redacted — after deleting the stored
text, because members can read the whole tree. The same text hash already active answers
`alreadyAdded` instead of feeding the document twice.

**A page read is the text plus what it cites; the full source list is provenance, not payload
(AT-2614).** `sourceKeys` only grows outside a rebuild, because the withdrawal needs every source a
page ever leaned on, and on the reporting wiki 57% of listed sources were no longer cited, so a read
was mostly source list. `read_knowledge_page` returns the cited ones (`splitKnowledgePageSources`)
plus `otherSourceCount`, and the wiki view folds the rest away. Never prune `sourceKeys` to fix this.
The assistant context and every read say when the wiki last caught up (`lastSuccessfulRunAt`,
written only by completed or partial runs) and that later changes may be missing.

**Wiki search answers from Firestore, the index only narrows where to look.** `search_knowledge`
(`knowledgeSearch.js`) scans the target project's visible pages fresh and quotes passages, so a page
hidden for a rebuild is never quoted however stale `dev_wiki` is. Global search has a Wiki tab on
`dev_wiki` (records `isPublicFor: ['0']`; the scoped key's `projectId` filter is the access rule,
page text is matched but excluded from responses). `onWriteKnowledgePageSecondGen` mirrors each
page, and `invalidateKnowledgeSource` deletes withdrawn pages from the index itself. "Only what I
created" skips the Wiki tab: the wiki writes every page.

**A search collection the browser key's PARENT does not list answers 401, and global search shows
that as "no results" (AT-2905).** Every browser search key is a scoped key derived from a parent
search key, and a scoped key can only reach the parent's collections. The parent was created by
hand in Typesense Cloud for the original five collections (`TYPESENSE_SCOPED_SEARCH_PARENT_API_KEY`),
so when the Artifacts and Wiki tabs were added, every request to `dev_artifacts` and `dev_wiki` came
back 401. The client re-fetched a key from the same parent, got 401 again, and printed only a
`console.log`. Both tabs looked as if they were not searching at all. In the logs this shows up as two
`getTypesenseScopedSearchCredentialsSecondGen` POSTs in the same second, one forced refresh per
failing tab. `functions/Typesense/scopedSearchParentKey.js` now provisions the parent with the
admin key, from `ALL_COLLECTIONS`, under a value derived from the admin key and the collection list
(an HMAC). Every instance therefore computes the same key, a 409 "already exists" counts as success,
and adding a collection creates a new parent on the next cold start. Superseded parents are kept
because an older instance may still issue keys from them. The parent may only `documents:search`,
which Typesense requires for scoped keys. The configured key is now only a fallback when provisioning
fails, and that failure is logged as an error. Add a new search collection to `ALL_COLLECTIONS`,
never to a hand-made key. Global search shows its tabs in `GLOBAL_SEARCH_TAB_ORDER` (`Header.js`):
Artifacts before Chats, like the main navigation. The tab numbers stay as they are because the
@-mention picker shares 0-4. Tab-key cycling and the fallback to the first tab with results follow
the shown order. Pinned by `functions/Typesense/scopedSearchParentKey.test.js`, the AT-2905 cases in
`scopedSearchCredentials.test.js` and `components/GlobalSearchAlgolia/Header/Header.test.js`.

**Global search ranks the user's own objects first, filter or not (AT-2945).** With "only what I
created" off, every tab except the wiki sends `boostCreator: { attribute, userId }`
(`getCreatedByMeBoost` in `typesenseSearchFilters.js`, same creator attribute as the filter), and
`buildRecencySortBy` folds it into the first sort field as a weighted `_eval`: own exact identity
match, other exact match, own match, the rest. Then the AT-2663 relevance buckets and recency apply
inside each group. It shares the exact-match `_eval` because Typesense rejects a fourth sort field
("Only upto 3 sort fields are allowed"). It is a sort, never a filter: access stays in `filter_by`
alone, and the AT-2527 identity-first merge still puts title matches ahead of body-only ones. With
the filter on, for anonymous viewers, on the wiki, in pickers and in server-side search, no boost is
sent. Pinned by `searchRanking.test.js`, the AT-2945 case in `searchRanking.integration.test.cjs`
(real Typesense 29), `typesenseSearchFilters.test.js` and `GlobalSearchModal.createdByMe.test.js`.

**The browser search key admits what Firestore's `readerIds` admits, no more (security audit
NV-40).** `buildEmbeddedAccessFilter` (`functions/Typesense/scopedSearchCredentials.js`) used to add
`ws@default` and every workstream whose `userIds` named the caller to the key's `isPublicFor`
filter. Workstream membership is member-writable, and the Firestore projection
(`buildObjectAccessProjection`) keeps only `0` and explicit member uids from `isPublicFor`, so search
returned private objects Firestore denied. The filter is now `projectId` in the caller's projects
and `isPublicFor` in `[0, uid]`. Index records carry only `isPublicFor` (no `readerIds`), and no
reindex is needed. Product effect: a private object shared with a workstream is searchable by the
members listed by uid when it was shared, exactly as it is readable, not by later members. The
privacy picker's `getAllOwnerIds` had the bug that made this matter: `secondaryOwnersIds - [...]`
discarded the workstream's members, so a workstream-owned private object listed no member uids at
all. Pinned by `scopedSearchCredentials.test.js` and `PrivacyModal/getAllOwnerIds.test.js`.

**"Save to wiki" never shares an ambiguous text unseen.** `save_knowledge_contribution`
(`knowledgeContributions.js`, `[[contribution:ID]]`) saves the member's own words directly; an
assistant summary, possibly private text or a different target project first becomes a draft in the
server-only `knowledgeContributionDrafts` collection, NOT in the wiki tree (members read that tree
straight from Firestore). Confirming needs `confirmed: true` and, where the channel has message
ids, a later message than the draft's. The card says it is a member's statement, not a verified
record, and the ingest keeps conflicts with other sources as open questions.

Confirmation resolves an owned draft's destination before checking current project membership,
so a cross-project confirmation without `projectId` never falls back to the chat project. An
explicit conflicting target is refused. Pending drafts are scoped to the requesting user and
exact conversation, included in the next reply's context, and reused for unchanged text. Choosing
a new destination for the same text preserves its earlier message boundary; changed text needs
a new confirmation. Draft creation (`saved: false`, `needsConfirmation: true`) and structured
tool failures do not reset the tool loop's three-round no-progress guard (AT-2904).

**The weekly health check may only spend the first 80% of the cap (`knowledgeLint.js`).** A
rule-based `lintReport` is written on runs that changed pages; the model pass runs once the run
has caught up, at most every 7 days, only if a page changed, changes at most 10 pages, never one
corrected in the last 14 days, and records revision mode `lint` with a `lint:` reason. It must not
settle a contradiction by recency alone; it adds an "Open questions" section instead.

**PowerPoint and Excel are read as text everywhere a file reaches an assistant.**
`functions/Utils/officeDocumentText.js` turns .pptx (slides in the deck's own order from
`presentation.xml`, speaker notes, no field text) and .xlsx (rows with " | ", dates formatted from
the cell's number format, cached formula results) into text; `extractTextFromWhatsAppFile` uses it
for WhatsApp, inbound email and chat uploads alike, and takes a `maxChars` budget (8,000 inline,
120,000 for the wiki). A chat upload the model sees only the beginning of is now labelled
`[FILE: name, type=…, only the first N characters]` (`extractionTruncated`), so it cannot answer
about the whole deck from its first slides. The archive is untrusted: each part's declared size is
checked before it is inflated (60 MB per part, 150 MB in all). Legacy .ppt/.xls and Keynote stay
unsupported. `jszip` is pinned to 3.10.1, the version mammoth already brought in. Pinned by
`officeDocumentText.test.js` (real files written by python-pptx/openpyxl and re-saved by
LibreOffice, whose markup differs), `knowledgeDocuments.test.js` (a real deck end to end into the
ingest's source card) and the `documents added to the wiki` block of
`collectKnowledgeSources.test.js`.

Keep the parser `components/WikiView/wikiMarkdownParser.js` and the renderer `WikiMarkdown.js`
under different names: a `wikiMarkdown.js` next to `WikiMarkdown.js` collides on macOS's
case-insensitive filesystem. The renderer is deliberately self-written (no Markdown dependency, no
HTML): page links, source chips and http(s) links are the only interactive output.
