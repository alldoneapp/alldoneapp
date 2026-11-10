# Assistant runs: workflow steps, idempotency, queueing, heartbeats

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

**An AI workflow step finishes when its work finishes, not when the assistant stops talking.** `execute_task_in_vm` returns as soon as the job is enqueued, so a step whose assistant dispatched a VM job would otherwise hand the task to the next reviewer while the work it asked for runs on for up to five hours. `runWorkflowAiStep` therefore parks the run as `awaiting_vm` with the dispatched correlation ids instead of advancing. The VM runner calls `resolveWorkflowAfterVmJobSettlement` after result delivery, billing/refunds, queue handoff and the terminal status write, so the parked workflow re-checks immediately without adding an Eventarc invocation for every 30-second VM heartbeat. `onUpdateWorkflowAssistantRunSecondGen` closes the pre-VM ordering window where the chat assistant lock can be the last blocker to settle. The one-minute `runWorkflowAiStepsSecondGen` poller still calls `resolveAwaitingVmRuns` as a recovery and timeout backstop; it is no longer the normal completion signal. The task move and workflow-run settlement share one Firestore transaction so a runner retry, Eventarc redelivery or an overlapping poll tick cannot advance twice. A failed or cancelled VM job still settles its parked run instead of leaving it stuck, matching how a failed assistant run behaves — but note it does **not** move the task: `finalizeWorkflowAiRun` only builds a step transition when there is no `failureReason`, so a failed step stays where it is and is handed to the requesting user by the AT-2196 reviewer hold below. `AWAITING_VM_TIMEOUT_MS` is the backstop for a job that never settles and is derived from `vmJobConfig`'s runtime + finalization budget, so raising the VM budget cannot silently leave it behind. **A VM agent can stop and ask the user a question** (`status: 'awaiting_user'`, see `vmInteraction.js`), and that interaction stays open for `VM_INTERACTION_TTL_MS` — 24h, far beyond the run budget — so `resolveAwaitingDeadline` pushes the deadline out to the job's own `interactionExpiresAt` plus a further run budget rather than abandoning a step the user can still rescue by answering. It stays bounded because each extension needs a real, unexpired interaction: a job that simply hangs is still abandoned on the original schedule. Note an unattended step whose agent asks a question simply waits — nobody is watching the thread. Check the parked run by its recorded correlation ids, never by re-querying the task for recent jobs: the jobs were started _before_ the run parked, so any time-windowed lookup misses them and advances immediately.

**Whether a step's configured prompt is suppressed is decided in the task trigger, not in the dispatcher (AT-2222).** A step that lands on a task the assistant is already working on must not post its configured prompt on top of that work; the run parks as `awaiting_vm` with `awaitingSkipReason: 'task_ai_run_already_active'` and settles `skipped`, advancing the task once the live work finishes. The trap is _when_ liveness is measured. `runWorkflowAiStepsSecondGen` is a one-minute poller (a prompt run cannot live behind a 540s event trigger), so a check made there answers "is something running a minute later", not "was something running when the task arrived". A VM job lives for hours and is therefore always still visible; **a normal assistant answer is usually over inside that minute**, so the step posted its configured prompt straight after the answer the user had just read — the same logic, opposite outcome, purely because of duration. `enqueueWorkflowAiRunIfNeeded` therefore evaluates `findLiveTaskAiWork` itself — the `onUpdateTask`/`onCreateTask` fan-out is the only moment synchronous with the task landing on the step — and creates the run already parked. `runWorkflowAiStep` keeps its own checks for work that starts during the gap and is still running. Only genuinely live work blocks: a settled chat run or a terminal VM job never suppresses a step. Two things the check must **not** look at, both of which would stall every AI→AI workflow: the coarse `assistantTaskRunLocks` slot (an AI step advances the task from _inside_ its own run, so its lock is still held when the next step is enqueued — this is why detection uses the message-level `assistantRunLocks` instead, which workflow runs never write), and any time window rather than live state. Detection is task-scoped (`objectId == taskId`), so an assistant creating a task from another thread cannot park the new task behind its own run. Heartbeats and recurring assistant tasks write no lock at all and so never suppress a step — deliberate: only human-triggered work counts as "the thread is already being served".

**A background assistant run only gets full task context if you give it a trigger message.** `generatePreConfigTaskResult` takes its canonical path — `getOptimizedContextMessages`, which assembles project, task title, task description, prior chat history, mentioned notes and open-task counts — **only** when `options.triggerMessageId` names a comment that exists in the thread. With no trigger message it silently falls back to base instructions plus the bare prompt, so the assistant has no idea which task it is working on. This is why background runs seed the thread first: post the prompt as a real user-authored comment via `postUserRequestComment` (`assistantHelper.js`) and pass the returned id as `triggerMessageId`. Both the VM host task and workflow AI steps do this; it also means the user reads exactly what was asked, and the exchange stays in history for the next step. Passing the prompt alone is the trap — it looks like it works, and the answers are just quietly ungrounded.

**Anything hosting an assistant prompt run must derive its timeout from `functions/Assistant/assistantRunLimits.js`.** A prompt run gets a 55-minute wall clock (25 for heartbeats, sized to the Cloud Tasks ceiling), and the transport must outlive the run it carries — a transport that dies first kills the assistant mid-answer and is indistinguishable from a crash. The timeout is computed from the wall clock rather than hardcoded alongside it, and `assistantRunLimits.test.js` fails the build if any entry point in `ASSISTANT_RUN_HOSTS` drops below its run's budget, sits behind an event trigger, or if any event-triggered function anywhere in `index.js` exceeds 540s. **Add a function to `ASSISTANT_RUN_HOSTS` when it starts executing prompts.** A long assistant run cannot live behind a Firestore trigger at all: `runWorkflowAiStepsSecondGen` is therefore a one-minute `onSchedule` poller that claims `pending` runs out of `workflowAiRuns` under a Firestore lease, the same way `checkRecurringAssistantTasks` already runs assistant work on the full budget.

## A callable that hosts an assistant run must be idempotent, because the browser will replay it

A callable is not idempotent by itself, and an assistant prompt run — tens of seconds of wall clock —
is exactly the request whose response a client loses. The reproducer is a laptop lid: a
`generatePreConfigTaskResultSecondGen` POST went out at 11:33:06, `pmset` recorded
`Entering Sleep state due to 'Clamshell Sleep'` at 11:33:22, the server finished the run at 11:33:36
into a socket that was asleep, and at 11:37:41 — the same second as the wake — **Chrome
retransmitted the identical request**. One user action, two answers in the thread and two 22-Gold
charges. Nothing failed anywhere: both invocations logged success, and the only tells were the
byte-identical `requestSize`, the **missing CORS preflight** on the second POST (a resumed fetch does
not redo one, while every browser-initiated callable in the logs is preceded by an `OPTIONS`) and the
fact that only **one** user comment exists — every JS path to that callable writes the comment before
calling it, so the app demonstrably never ran that code twice.

`askToBotSecondGen` had been guarded against this since the run-lock work; the pre-configured prompt
path had not, although it receives the same client-generated `messageId` and already passes it down
as `triggerMessageId`. Both now take `acquireAssistantRunLock` on
`{projectId, objectType, objectId, messageId}` and settle it on **both** paths — a lock left
`running` holds the coarse `assistantTaskRunLocks` slot for its 65-minute lease, which blocks
workflow AI steps on that task and makes a legitimate retry look like a duplicate. **Add the lock
when a new entry point starts hosting a prompt run**; `assistantRunIdempotencyHosts.test.js`
ratchets it over the `index.js` source, the way `assistantRunLimits.test.js` does for timeouts.

Two details are load-bearing. The lock is completed **before** `completeOnDemandAssistantTaskAfterRun`,
so a crash between them leaves a settled lock rather than a running one — and the duplicate branch
then reconciles the task completion itself (it is idempotent, `alreadyCompleted`) instead of leaving
the task open. And a duplicate reports **no completion outcome of its own** while the original run is
still going, so the client must not fall back to `moveTasksFromOpen`: `generateTaskFromPreConfig`
treats `duplicate: true` as "another invocation owns this task", which is a third meaning alongside
the contract's existing "server succeeded" and "no outcome reported". A request carrying no
`messageId` (an empty prompt) acquires nothing and behaves exactly as before.

## A user message is answered only if the sender's page gets its request out, so the server checks (AT-2848)

The replay above is one way a callable goes wrong; the opposite is the request that never leaves.
`createObjectMessage` stores the comment and then calls `askToBotSecondGen` **without awaiting it**,
and nothing on the server reacted to a user comment. When the page went away in between, the comment
was saved and never answered, with no error anywhere. Reproducer (2026-10-25, Android app): a topic
from the assistant line, the `askToBot` CORS preflight logged at 19:29:55 UTC, 8.3s spent
cold-starting (no warm instances since the cost review), and the page freshly loaded around 19:30
(the boot batch of email-line, calendar-sync and Typesense calls repeats). The POST was never
received. A missing POST
after an `OPTIONS` 204 from the same `remoteIp` is the tell.

`functions/Assistant/assistantMissedRunCatchUp.js` closes it with **evidence, not guesswork**. The
client records the run it is about to start on the comment (`assistantRunRequest: {projectId,
objectType, objectId, assistantId}`, written in the comment's own batch, so it is exactly as durable
as the message). Anna's workspace sets it through `submission.requestsAssistantRun` because it starts
its run itself. `onCreateObjectCommentSecondGen` schedules a check `MISSED_RUN_GRACE_SECONDS` (90s)
later on the **existing** `runAssistantCommentReply` queue (`kind: 'missed_user_run'`, deterministic
task id), so no new function and no IAM grant was needed. The check reads the per-message run lock
first: the client's run takes it before anything else, so an existing lock in **any** state ends the
check after one read, which is the outcome for nearly every message. Only a missing lock goes on to
run `askToOpenAIBot` for the comment's author on the heartbeat 25-minute budget, with
`retryFailed: false`. A client request that arrives later meets that lock and returns `duplicate`.

What keeps it from answering twice or answering the wrong thing: the request must name the comment's
**current** location, so a comment copied with its thread into another project or object does not get
a second answer at its new address. A thread that has **any newer comment** is skipped, since that
message's run (or its own catch-up) carries this one in its history. The assistant switched off
(`isAssistantEnabled === false`), a webhook task, a deleted comment or thread, failing the callable's
own `assertObjectAccess`, or a comment older than 24h all skip without taking the lock. Server-written
user turns (WhatsApp daily topic, VM host requests, workflow step prompts) never carry the field, so
they are untouched by construction. Clients older than this change write no field and keep the old
behaviour. Pinned by `functions/Assistant/assistantMissedRunCatchUp.test.js` (including the
`index.js` wiring) and the `recording the assistant run a comment expects` block of
`utils/backends/Chats/chatsComments.outbox.test.js`. `generatePreConfigTaskResultSecondGen` has no
catch-up: its requests carry task-completion semantics a server rerun would have to reproduce.

## One assistant turn at a time per thread (AT-2922)

A message that asks the assistant for an answer is **held on this device** while the previous
answer in the same thread is still being produced, and is written into the thread only once that
answer is complete, so the history always reads question, answer, question, answer. Before this,
the comment outbox already stored messages in order, but every send started its own `askToBot` at
once: two runs worked in parallel, the second never saw the first answer, and the answers could
land in either order. "Complete" includes every tool round **and a VM job the answer started in
that thread** (product decision: the next message waits for the VM too). Other conversations are
never blocked, and a message that does not ask the assistant (assistant off, webhook task) is
never held.

`utils/backends/Chats/threadRunGate.js` decides "still processing" from three signals, because
each covers a gap the others cannot see: runs this tab started (`beginThreadRun`/`settleThreadRun`,
the cold-start seconds before the server creates its comment); a comment in the thread that is
still being written (a chat run's `assistantRun.status`, a VM status comment while queued,
running, `awaiting_user` or `cancel_requested`, found by two small listeners that exist only
while something waits), which is what makes other tabs, devices and members count; and a newest
user comment carrying `assistantRunRequest` with no answer after it yet (the cold start of a run
another device started). Every signal **expires** (local run 65 min, chat run 70 min, VM run 6 h,
VM question 25 h after its last change; a pending request after 150 s; a missing snapshot after
4 s), so a crashed run delays a message but cannot strand it, and the user can always **send a
queued message now or remove it** from the bubble. A failed or stopped answer releases the queue.

Where it is enforced: in the comment outbox, inside `sendObjectMessage`, after the parent read
decided that the message triggers a run and **before anything is written** (the outbox pauses its
30 s delivery timeout through `hold` while it waits, and a message that really waited is prepared
again from scratch). The released message is dated `max(now, newest comment + 1)`, because the
answer it waited for was timestamped by the server's clock. Anna starts its runs itself, so
`useAnnaMessageSends` waits on the same gate before persisting and passes `threadGateCleared`.
While waiting the outbox entry has `status: 'queued'`; `useGetMessages` sorts queued entries after
everything saved, and `MessageSendStatus` renders "Queued" plus Send now / Remove. In Anna that note
sits on its own line under the author row (`prominent`, AT-2927), outside the queued message's
fade: inline, a react-native-web `View` keeps `flex-shrink: 0`, so the status ran past the
bubble, squeezed "You" to 0px and hid both actions (`browser-tests/at2927` measures it). In the
task/topic chat (`MessageItem`) the fade goes on the header + content, never on the swipe row:
that row's opaque background is what hides the green "Quote" swipe layer underneath it, and a
translucent row let the layer show through over the avatar and name (AT-2963,
`MessageItemQueuedLayout.test.js`). A failed
delivery drops `threadGateCleared`/`forceSend`, so a retry waits for its turn again. Out of scope:
WhatsApp (its inbound queue is already serial per user), voice calls and pre-configured prompt
buttons (their runs still hold chat messages in the thread). Known limit: a VM job hosted in a
**different** thread (a contextless dispatch creates its own task) is not visible to the
conversation that started it. Pinned by `threadRunGate.test.js`, the `one assistant turn at a time
per thread` block of `chatsComments.outbox.test.js`, the AT-2922 cases in `commentOutbox.test.js`,
`AnnaConversation.test.js`, `MessageSendStatus.test.js` and `useGetMessages.pending.test.js`.

## A thread can pin its own assistant model (AT-2502)

**The model lives on the THREAD's own document, next to the assistant that answers there.**
`assistantId` and `isAssistantEnabled` already describe one thread and already live on its host
document — the task doc for a task thread, `chatObjects/{projectId}/chats/{id}` for a topic, the
note/goal/contact/skill/user doc for those — so `assistantModelOverride` joins them there rather
than in a new collection. Nothing new to authorize (whoever may change a thread's assistant may
change its model), no rules change, no index. Both sides address that document through the **same**
`getObjectDocPath` in `functions/shared/privacyAccess.js` — the client to write it, Cloud Functions
to read it — because a writer and a reader that each carry their own objectType→path map is how a
pin gets stored somewhere nothing looks. `functions/Assistant/threadAssistantModel.js` is the
dependency-light shared module (validation, picker options, precedence) and is imported by both.

**It is resolved on the SERVER, because the interactive chat path has no model to forge.**
`askToBotSecondGen` receives no model at all — it never did — so `assistantNormalTalk_optimized`
reads the pin alongside the user and the assistant in the existing `Promise.all` (no extra wall
clock) and resolves the effective model there. **Never assign it back onto the assistant object**:
`getAssistantForChat` returns a module-level cache entry keyed on (projectId, assistantId), shared
by every thread a warm instance serves, so `assistant.model = …` leaks one conversation's pin into
the next conversation — a wrong model and a wrong Gold rate, vanishing whenever the instance
recycles. `threadAssistantModelCallSites.test.js` ratchets both that and the read itself, because
neither failure reports anything.

**Precedence is: the model chosen for the WORK, then the thread, then the assistant.** A
pre-configured task carrying its own `aiModelOverride` was configured for that model deliberately,
and the thread it happens to run in must not re-point it. That ordering is applied twice, and the
split is deliberate: server-side in `getTaskOrAssistantSettings`, and client-side in
`resolvePreConfigAiSettings` — the prompt path sends complete `aiSettings` and by the time they
reach `generatePreConfigTaskResult` "configured for this model" and "the assistant's default was
filled in" are the same string, so the client is the last place that can still tell them apart.
Deliberately **not** applied to unattended runs (heartbeats, recurring tasks, workflow AI steps).

**A stored model key is validated on every read, never trusted.** The `featureModelPreferences`
lesson with teeth: an unknown key makes `getModel` answer `gpt-5.6-sol` while `getTokensPerGold`
answers `undefined`, which `calculateGoldCostFromTokens` turns into a charge of **zero** — so a
thread pinned to a model that is later retired would run free, forever, silently. An override that
is not currently in `SELECTABLE_ASSISTANT_MODELS` is treated as absent. Clearing deletes the field
rather than writing null, and the write carries no edition data (a settings choice is not content —
stamping `lastEditionDate` would re-download the note on every other open client, AT-2340).

**Assistant threads are excluded on purpose.** An assistant's own board is the one thread where "the
thread's model" and "the assistant's model" are the same question, and the two sides disagree about
which document an assistant even is (the app stores assistants as user docs, `getObjectDocPath` maps
them to the assistants collection), so a pin there would be written and never read back.

UI is one row in the existing assistant popup (`BotOptionsModal`, reached from all four buttons) plus
a dot on the assistant avatar. The badge costs one document read, so it is **opt-in**:
`DvBotButton` is both the detail-view header avatar and the task-list row button, and the list must
never badge — that would be one read per visible task. `threadAssistantModelState.js` holds the one
cache the row, the picker and the badge share; it is deliberately not redux, since a slice keyed by
object id re-renders every subscriber on every write (AT-2336) for state that concerns one thread.

## A scheduled assistant task needs no approval of its content (decision 2026-11-09)

Any project member, and the user's own assistants, may change a project assistant task's prompt,
system instruction, model and settings, and a scheduled run then acts as the user who activated it
(their Gold, tools and connected accounts). That is deliberate: a user trusts the members of their
projects and their own assistants. The security audit's NEW-A binding (an approved content hash per
user, a paused run plus a notice after somebody else's edit, and a confirmation before a manual run
of unapproved content) was removed on 2026-11-09 for that reason; do not reintroduce it without asking.
Documents written while it was live may still carry `approvedContentHashByUser` and
`contentApprovalNoticeByUser`; nothing reads them.

## Assistant heartbeat scheduler

- Heartbeats are registered per assistant/user in the server-only `assistantHeartbeatSchedules` collection. `checkAssistantHeartbeats` only dispatches schedules due in the next five minutes; `runAssistantHeartbeat` performs one at-most-once occurrence through Cloud Tasks with five concurrent workers.
- Run `node migration/backfillAssistantHeartbeatSchedules.js --firebase-project-id=<project> --execute` after deploying the worker and indexes. Without `--execute` the script is a dry run.
- Cloud Tasks IAM must be granted to the **firebase-adminsdk SA** after deploying `runAssistantHeartbeat`. Run `functions/Assistant/grant-heartbeat-task-worker.sh <projectId>`; it grants project-level enqueue, self `actAs`, and `run.invoker` on the worker.
- Rollback requires pausing or purging the `runassistantheartbeat` task queue before restoring the legacy scanner. Legacy assistant heartbeat status maps are intentionally retained.
- **A heartbeat runs as a member only after that member confirmed it (security audit NV-17).** A heartbeat runs unattended with the member's identity, Gold and connected accounts (`search_gmail` reads their mailbox), while its prompt, tools and instructions sit on the shared assistant document that every member may edit. `functions/Assistant/heartbeatOptIn.js` therefore requires `users/{uid}.heartbeatOptIns["<projectId>__<assistantId>"].configHash` to equal the hash of the assistant's current heartbeat prompt, `allowedTools`, `instructions` and `mcpServers`. Chance, interval, awake window, model and WhatsApp delivery are not hashed. `buildHeartbeatScheduleData`, the worker and the legacy scanner all check it, so any other member's change to one of those fields stops the heartbeat for everyone who confirmed the old version. Members confirm, re-confirm or revoke through the `assistantHeartbeatOptIn` callable (row "Run heartbeat for me" in the heartbeat settings; the client never computes the hash). The client calls `refresh` after the member's own edit to instructions, heartbeat prompt or tools, which re-confirms only for a member who had already confirmed. The server confirms for a project's **only** member at the moments nobody else can have written the configuration: assistant created, hashed field changed, project created (`confirmHeartbeatsForSoleMember`, before the schedule sync). Being alone is not trust in itself: someone who changes the prompt and then leaves must not have it run as the member left behind. MCP-server changes made through the server-side connect flow need a fresh confirmation in shared projects. A heartbeat topic (`Heartbeat<date><uid>`) is now `isPublicFor: [uid]`, and an existing project-visible one is made private on reuse. The WhatsApp daily topic stays project-visible by design. One-time migration: `node migration/confirmAssistantHeartbeats.js --firebase-project-id=<project>` (dry run; `--execute`). Run it right before and again right after the functions deploy. The default `--scope=owner` confirms the only member of a one-member project and the assistant's `creatorId` in shared projects; `--scope=all` keeps today's fan-out.

## A scheduled run claims the lastExecuted the scan wrote, not the one it read (2026-11-10)

`checkAndExecuteRecurringTasks` moves `lastExecuted`/`lastExecutedByUser[uid]` forward the moment it
queues an occurrence, so the next five-minute scan does not queue it again. Since `e2cfa030fd`
(2026-09-27) the direct-mode run then calls `claimScheduledPromptAttempt`, which refuses when the
stored `lastExecuted` differs from the task it was handed — and it was handed the snapshot the scan
read **before** its own write. Every direct-mode scheduled prompt (all MCP-created ones, and workflow
tasks whose assistant has no workflow step) therefore refused itself and returned with no error, no
Gold and no task. The only trace was a `lastRun` a few seconds after a scheduler tick instead of the
finish time. Found when the Growth Lead's "Daily growth discovery" never ran.

The scan now reserves the occurrence through `reserveScheduledOccurrence` (a transaction that writes
only if `lastExecuted` is still what the scan read, so two overlapping scans queue it once), and the
reserved value travels to the claim as `expectedLastExecuted`. The run keeps the scanned snapshot,
because a failed run restores its `lastExecuted` so the next scan retries. Pinned by the
`the scan reserves an occurrence and the run claims what the scan wrote` block of
`functions/Assistant/assistantRecurringContinuation.test.js`; the earlier integration test called
`executeAssistantTask` directly, skipping the scan's write, which is why it stayed green.
