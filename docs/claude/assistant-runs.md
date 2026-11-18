# Assistant runs: workflow steps, idempotency, queueing, heartbeats

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## The commissioning chat always links the task the work continues in (AT-3096, 2026-11-18)

Karsten asked in a CTO chat for weekly project-description updates; the reply was "Die Umsetzung
läuft in **AT-3095** weiter" with no link. The **result** side already linked the task in every
server-written line (VM result note, 📋 review notice, step-change line, VM question notice, template
notices). The **hand-off** reply was model prose. Product decision: both moments always show the
canonical task link (`{base}/projects/{pid}/tasks/{tid}/chat`), as platform behaviour.

- **Tool results** (`functions/Assistant/delegatedTaskLinks.js`, `withDelegatedTaskLink`):
  `create_task` with `trackAssistantWork` (workflow and direct) and every delegation answer of
  `execute_task_in_vm` (`workflow_managed`/`task_changed` from a created host task,
  `workflow_managed`/`workflow_step_restarted`/`needs_workflow_choice` when joining a delegated task)
  carry `taskUrl` and `delegatedTask`, built only from the ids the tool resolved. The hand-off
  instruction tells the model to pass `taskUrl` on and never build or placeholder a link.
- **Safety net:** both run paths (`storeChunks` and the non-streaming collector, which also feeds
  `talk_to_assistant` results via `delegatedTaskResults`) run `ensureDelegatedTaskLinksInResponse`
  after the note and VM link helpers. It rewrites any URL of the same task (wrong project, no
  `/chat`) to the canonical one, appends `Follow it here: …` / `Hier geht es weiter: …` /
  `Síguelo aquí: …` (`noticeLanguage` key `taskLink.follow`, run language) when missing, dedupes per
  task and against the VM host link, and adds nothing when the reply is written in that task's chat.
  Plain `create_task` (no delegation) is untouched. The VM host link line uses the same localized key.
- **VM hand-off to another task:** `onVmHandoff` links the frozen introduction itself, because a
  follow-up message (result after `get_vm_job`) gets the link at finalization while the introduction
  stays frozen.
- **Delegates:** a `talk_to_assistant` delegate has no conversation. `executeDelegatedAssistantRequest`
  now forwards `originTracksWork` (the caller's chat is Anna's or a tracked project chat), and
  `resolveDelegationOrigin` (`annaTaskDelegation.js`) records that chat on the receipt, so the review
  notice and step-change lines of a task the delegate created reach the chat the user asked in. A
  task thread is still never an origin; nested delegates keep no origin, as before.
- **Privacy:** only the task URL (and a known human-readable id) is added, never the task name; the
  link opens nothing a reader could not already open.

Coverage: `delegatedTaskLinks.test.js`, the AT-3096 cases in `assistantHelper.test.js` (create_task
results, the end-to-end German reply, the frozen VM introduction, the delegate receipt) and
`annaTaskDelegation.test.js`. Ships with the Functions deploy; the runner image is not involved.

### No link to the task the user is already in (AT-3096 follow-up, 2026-11-18)

Regression after the deploy: in the chat of task `Q2XA2dxekAsf9QjI24yS` (AT-3093) Karsten wrote
"please try again"; the reply ended "The result will appear here: <link to that same task>". Logs
(execution `m869zj6c0crc`): `execute_task_in_vm` ran in the task's own chat, joined it as a delegated
workflow task (`workflow_managed`), and `withDelegatedTaskLink` put a `taskUrl` of that task into the
result. The model passed it on. The server line was not involved: the safety net already skipped the
current task. The VM start result had the same flaw ("The work lives in this thread: <url> — include
that link") for every VM started in the conversation the assistant answers in.

- `withDelegatedTaskLink(..., { currentThread })` (all three `execute_task_in_vm` hand-offs) returns
  no URL for the current task: `continuesInCurrentConversation`, a `linkInstruction`, and
  `delegatedTask: { projectId, taskId, currentConversation: true }` (a marker without URL; nothing is
  ever appended for it). `move_task_workflow_step` in the task's own chat returns the same marker.
- `startVmJob({ callerThread })`: a VM in the caller's thread gets a hint that says not to link it.
  `hostThreadUrl` stays in the result for the notification guard.
- Safety net: when a run's hand-off (marker, delegated reference or started VM) is the current thread,
  `removeCurrentThreadLinks` takes links to that thread out of the reply and tidies the sentence
  ("…here: <link>" → "…here."). The frozen in-thread VM introduction gets the same treatment. Links to
  other tasks stay; a self-link in a reply with no hand-off (the user asked for the link) is kept.
- Only a **task** chat is "the task". A topic chat (CTO chat, Anna) still gets hand-off and result links.
  Result notices were already safe: they go to the stored origin, which is never the task itself.

Coverage: the "gets no link to itself", `removeCurrentThreadLinks` and in-thread VM cases in
`delegatedTaskLinks.test.js`, the two Q2XA2-style cases in `assistantHelper.test.js` (Anna VM message
order), `vmJob.test.js` (host hint) and `workflowStepMove.test.js` (marker only in the own chat).

## A template started in the Anna chat announces its task there (AT-3082, 2026-11-18)

The Anna composer's **Templates** button (for example Anna's "Historical fact of the day" prompt)
runs `generateTaskFromPreConfig(..., { skipNavigation: true })`. That creates a new assistant task and
answers in that task's own thread. The Anna chat the user clicked in stayed silent. Product decision
(Karsten, confirmed 2026-11-18): the same approach as delegated tasks. The chat says the task
started, and says it again when the task has its result, with Anna's summary.

- **Client:** `AnnaConversation` passes `originConversation` (`{ projectId, objectType: 'topics',
objectId }` of its own chat) through `AssistantTaskSearchButtonWrapper` → `AssistantTaskSearchModal`
  (and `PreConfigTaskGeneratorModal` for templates with variables) → `generateTaskFromPreConfig`
  option → `executePreConfigPromptForTask` → `createTopicForPreConfigTask` → callable data. The
  assistant line and every other caller pass nothing and behave as before.
- **Server (`functions/Assistant/preConfigOriginNotice.js`, wired in
  `generatePreConfigTaskResultSecondGen`):** the origin from `request.data` is only a nomination.
  `resolvePreConfigOrigin` accepts it only for a `topics` chat with `annaOwnerId` and `creatorId` equal
  to the caller, in a project whose `userIds` lists the caller. The speaking assistant is the chat's
  stored `assistantId`. Anything else, or a read error, means no notice. Resolution and both notices
  run **after** the run lock is acquired, so a replayed POST (duplicate branch) posts nothing twice.
- **Lines** (assistant comments via `createInitialStatusMessage`, no bell, in the user's app
  language, see below): `🚀 I started PT-7 “…” for you. I will tell you here when it is done.` + link,
  posted in parallel with the run. After the run and the task completion: `✅ … is done.` (or "has its
  result." when the server did not complete it) + Anna's summary of the **actual** answer in the task
  thread (`summarizeVmResultForChat`, user's app language, Gold source `task_result_summary`, skipped
  at gold <= 0) + link. `⚠️ … could not finish` on a thrown run, `💬 … waits for your message` for a
  webhook template, `✅ … finished without an answer to report` for a silent run. The summary is
  never invented: without an answer there is no summary.
- **Later updates:** the origin is also handed to the run's tool runtime (`originProjectId` …), so a
  VM the template starts reports its result to the Anna chat through the AT-3074 notice.
- **Not covered:** templates whose `executionMode` is `workflow` (they do not use this callable; the
  workflow runner owns them). Coverage: `preConfigOriginNotice.test.js` (also checks the callable's
  wiring order from source), `AssistantTaskSearchModal.test.js`, the AT-3082 cases in
  `AnnaConversation.test.js`, `AssistantTaskSearchButtonWrapper.test.js` and `vmResultSummary.test.js`.

### Task notices in another conversation speak the user's language (AT-3082)

Karsten asked for the notices to be localized "überall". The fixed lines the server writes about a
task into another conversation used to be English for everybody. They now come from
`functions/Assistant/noticeLanguage.js` (en/de/es table; functions cannot import the app's
`i18n/`) in the recipient's `users/{uid}.language` (`loadNoticeLanguage`, English on a missing user
or a read error, never blocks the notice):

- the template notices above (`preConfigOriginNotice.js`);
- the delegated task review notice and the step-change line (`delegationReviewNotice.js`, owner's
  language; `Open`/`Done`/unnamed steps are translated, the user's own step names are not);
- the VM input notice (`vmInputNotice.js`, the asking user's language; VM questions, plan and reason
  stay as the VM wrote them);
- the VM result notice in the origin chat and on WhatsApp (`buildVmResultNoticeText` in
  `vmJobRunner.js`, the requesting user's language).

Task names are quoted in the language's marks (`„…“` in German). Builders default to English, so a
caller that passes no `language` keeps the old text. A new notice key goes into all three tables;
`noticeLanguage.test.js` fails when a language lacks a key or a placeholder. Left in English on
purpose: the task-thread note of `move_task_workflow_step` (`postApprovalNoteInTaskThread`), because a
task thread is shared by members with different languages and the assistant reads the note as an
instruction; and the VM's own status comments in the task thread.

## Work asked for in a project assistant's chat gets its own task (AT-3071, 2026-11-17)

Karsten asked Alldone CTO to build things in its chat, and the work (VM run included) happened in
that chat. Now a **chat** (topic) with a project assistant tracks substantial work the way Anna's
conversation does. `chatTaskTracking.js` decides when: objectType `topics`/`chats`, a member's turn
(not `automaticCommentReply`), not Anna (which has its own instructions). Task, note, goal and
contact threads are unchanged; a task thread already is the task. `assistantNormalTalk_optimized.js`
sets `chatTaskTracking` on the tool runtime and adds the instruction (only for assistants that have
`create_task` or the VM tool): quick questions and small edits stay in the chat, substantial work
becomes `create_task` with `trackAssistantWork`, then a one-line pointer to the task in the chat.
`execute_task_in_vm` treats a tracked chat like Anna's conversation (`tracksWorkInTasks`): never
hosted in the chat, a new tracked task or `target_task_id`, the chat recorded as origin. A
`continue_in_object_id: latest` still prefers a VM session the chat had before this change.

**No usable saved step no longer stops the work (Anna too).** `startDelegatedTaskWorkflow` used to
return `needs_workflow_choice` and leave the task Open. Karsten chose to start such tasks at once:
the transaction sets `taskMetadata.delegation.directStart`, and `withDelegationReviewStep` then
returns a task-specific workflow `~delegation-work` (the responsible assistant, "Work on request")
→ `~delegation-review` (owner, "Review result"), ignoring the saved workflow, which stays untouched.
The ordinary runner, VM parking, completion protection, review notice and `move_task_workflow_step`
therefore all apply unchanged. `needs_workflow_choice` remains only for older delegated tasks still
Open.

The first run of the work step must answer the user's request, not a generic prompt. The receipt in
`delegatedTaskOrigins` now also holds `assistantId` and `requestCommentId` (the request comment
`create_task`/`ensureVmJobThread` posted), and `runWorkflowAiStep` uses that comment as the trigger
message instead of posting `DELEGATION_WORK_PROMPT`. **Trap:** a send-back rebuilds `stepHistory` to
`[Open, ~delegation-work]`, identical to the first entry, so the history cannot tell the runs apart.
`claimDelegatedTaskRequest` records the first run id on the receipt (`requestRunId`); a retry of
that run gets the request again, a later run posts the step prompt. The receipt is written for
chat origins too now (`isTrackedOriginConversation`), so the "ready for review" notice and "merge
it" work in a project chat as they do for Anna. Coverage: `chatTaskTracking.test.js`, the AT-3071
cases in `workflowAiStep.test.js`, `delegatedTaskWorkflow.test.js` and `assistantHelper.test.js`.

## A VM run sent into another task brings its request along; tools quote the latest message (2026-11-16)

Two bugs showed on the crown-only Premium task (Alldone Product, MR !874). Alldone CTO answered
twice more in the task chat, once checking a screen size and once merging and deploying, with no
message there that asked for either. Karsten had asked Anna in the Privat daily chat. Anna sent both
into the task with `execute_task_in_vm` and `continue_in_object_id`. Only the path that **creates**
a host task posted the request (`ensureVmJobThread`). Continuing an earlier run or naming a task
with `target_task_id` put the instruction only in the `vmJobs` payload. The VM also said it could
not see the screenshot, because the screenshot never reached the thread `buildVmThreadContext`
reads.

The dispatch now posts the request first when the host thread is not the caller's own conversation
(`shouldPostVmRequestToHostThread` in `vmHostTaskHelper.js`). It does not post when the tool
created the task (that path already posts it), when the run is in the thread the user is typing in,
or when a workflow step owns the task (the step posts its own prompt). The comment is written with
`postUserRequestComment`, in the requesting user's name, with their images. The text is the brief
(objective, deliverable, original request) and a `**Passed on by:**` line naming the calling
assistant. The originating chat is neither named nor linked, because the task can be visible to
people who cannot see that chat, and chat titles can be private. The comment has no
`assistantRunRequest`, so the task's assistant does not answer it as well (see the AT-2848 section
below). Its id is `vm-request-<messageId>`: a dispatch the same answer retries after a failed launch
rewrites that comment instead of adding a second one. Posting is best-effort; a failure is logged
and the work still starts. The request is posted before the VM launches, so a launch that fails for
good leaves the request without an answer. A newly created host task behaves the same way.

The first brief on that task also said `Original request: [Sent at 19:19:46] merge it` while asking
not to merge. That was a four-hour-old message about another MR. `assistantNormalTalk_optimized.js`
built `userContext` from `messages.find(role === 'user')`, but `getOptimizedContextMessages` returns
the conversation oldest first and ends with the triggering message. So it took the oldest user turn
in the window, plus that turn's images. `userContext` is what tools quote: the VM brief, the request
`create_task` seeds into a delegated task, `get_chat_attachment`'s file matching and the user words
`vmRunOverrideGuard` accepts. `toolUserContext.js` (`buildToolUserContext`) now takes the **latest**
user entry for both the interactive and the pre-configured task path. Its `message` drops the
mentioned-notes context that `noteContextHelper` appends (the shared
`MENTIONED_NOTES_CONTEXT_HEADER`): note text is not the user's words, and it must not vouch for a VM
override. `content` keeps the notes for tool-loop continuations. The email bridge still reads its
first user entry; an email run has a single prompt. Coverage: `toolUserContext.test.js`,
`vmJobHostTask.test.js`, and the `the request of a run sent into another existing thread` block of
`assistantHelper.test.js`.

## Anna work routed to another project uses that project's assistant (2026-11-16)

AT-3060 was created from Anna's daily conversation in Privat and routed to Alldone Product,
but `trackAssistantWork` copied the calling assistant into the owner, reviewer, thread assistant
and `annaWorkspace` metadata. Its VM then independently used Anna's identity and persona instead
of Alldone CTO's. `annaTaskAssistant.js` now resolves the responsible assistant after the final
project choice (including a parent goal's project), using the daily chat's `findProjectAssistantId`:
flagged project default, then a valid configured project/global assistant. The selected assistant
is retained within its own project; projects without an available assistant retain the caller.
Cross-project resolution checks membership against the project document.

Both `create_task` tracking and automatic VM host-task creation persist that execution identity. The
creation response identifies `responsibleAssistant` and tells the caller to delegate further work
on the existing task. An Anna VM targeted at a task resolves the destination assistant before
creating its chat (preserving a valid assistant already selected on that task), checks that
assistant's VM Tools Access, and uses its identity and loaded persona
for execution. This dispatch does not require another model round. Billing and connected accounts
still belong to the requesting human; completion notifications still return to the original Anna
conversation as Anna. Explicit delegated VM calls outside Anna mode retain their chosen assistant.
Regression coverage is in `annaTaskAssistant.test.js` and the assignment/VM-routing cases of
`assistantHelper.test.js`.

## Delegated work stays user-owned and returns for review (2026-11-16)

`trackAssistantWork: true` now creates a user-owned task with the responsible project assistant
on `assistantId`, rather than forcing assistant ownership and `executionMode: direct`.
`annaTaskDelegation.js` seeds the original request in the task conversation before starting the
requester's saved project workflow. A usable step for the responsible assistant must exist; the
task starts at the **first** saved step, preserving any human or AI prerequisites. If no such step
exists, it stays Open and the tool returns `needs_workflow_choice`: offer workflow configuration
or explicit direct execution on this same task. No saved workflow is edited.

`functions/shared/delegatedTaskWorkflow.js` is shared with the frontend. For tasks carrying
`taskMetadata.delegation` it adds a task-specific `~delegation-review` step at the end, unless the
saved workflow already ends with the human owner. The normal workflow runner, task row, status
picker, chat controls, avatars and waiting-board headers all resolve this same effective workflow.
The owner can approve through the normal forward-to-Done action or send the same task back.
`TaskService` refuses completion before the final human review. Explicit `executionMode: direct`
remains available for independent assistant-owned tasks and deliberate workflow bypasses.

The workflow owns execution: `create_task` returns `workflow_managed` and tells the coordinator
not to launch additional work. `execute_task_in_vm` joins an existing delegated workflow rather
than starting a second VM; only the workflow's server runtime can dispatch its VM job. Contextless
VM requests create the same user-owned workflow task, and return the handoff or missing-workflow
choice. The existing deterministic run IDs and VM settlement transaction keep retries single and
wait for the VM before advancing to review. Delegates inside a workflow inherit its VM handoff.
Task-chat replies on managed delegations leave the actual workflow prompt queued rather than
substituting for it: asking for status must not skip the work and send an empty result to review.

**"Continue" restarts a failed step instead of being refused (2026-11-18).** The guard
(`getDelegatedTaskExecution`) left no way on once the step's own run had failed: on task
`nFzDtx2oPmJOsH5ztdGF` the VM restarted under the agent at a lease boundary, its notice said "reply
in this thread to continue", and the reply "please continue" was refused while the only control was
the "Needs attention" tag in the task list (`retryWorkflowAiRunSecondGen`), which Anna has no tool
for. Now, when `workflowAiStatus` is `failed` for the current step and the turn is one the user
typed (`isHumanTurn`, the same check as `move_task_workflow_step`), the guard calls
`retryFailedWorkflowAiRun` with the requesting user as payer and returns `workflow_step_restarted`.
The workflow still is the only thing that starts the VM: the restarted run waits for the replying
turn (`deferDelegatedWorkflowForConversation`) and continues in the same thread and VM session.
Heartbeats, emails and workflow prompts still get the refusal, which now names the failure and the
tag. Tests: `annaTaskDelegation.test.js`, and the in-thread case in `assistantHelper.test.js`.

**The "Needs attention" tag had never appeared.** `AssistantWorkflowRunTag` reads
`task.workflowAiStatus`, but `mapTaskData` (`utils/backends/firestore.js`), which every task passes
through on the client, did not name that field and so dropped it: on every row the tag rendered
nothing, failed steps included (AT-3082 was `failed` / `vm_interrupted` and showed only the "Failed
VM" session badge, which has no action). It is mapped now, and `uploadNewTask` deletes it from the
copy, because that function spreads its input and recurrences or duplicates would otherwise inherit a
"failed" step they never ran. Guardrail: `components/Tags/AssistantWorkflowRunTag.test.js`.

Anna's originating conversation is recorded in the server-only `delegatedTaskOrigins` collection,
not trusted from client-editable task metadata. Workflow VM jobs use that receipt for result
notifications. Task deletion removes the receipt. No credentials, indexes or rules deployment is
needed. Existing assistant-owned tasks are not migrated. Coverage includes the delegated lifecycle
in `workflowAiStep.test.js`, completion protection in `delegatedTaskWorkflow.test.js`, task/VM
routing in `assistantHelper.test.js`, and approval/send-back controls in the frontend tests.

**Open has two spellings (AT-3065, 2026-11-17).** `TaskModelBuilder` (every task created by an
assistant or over MCP) wrote `stepHistory: ['Open']` until 2026-11-17, while the app and the
workflow use `OPEN_STEP` (-1). The delegation start read `['Open']` as "not Open", moved nothing and
still answered `workflow_managed`, so Anna announced work that never started. New tasks start with
`[-1]`; existing ones keep `'Open'`, so test for Open with `isOpenStepId` (server
`Tasks/workflowStepHelper.js`, client `WorkflowView/workflowStepHelper.js`), never `=== OPEN_STEP`.
UIs that compare step _indexes_ work only by coincidence (`indexOf('Open')` is -1). A task that is
neither Open nor in the workflow now returns `task_changed` instead of a false `workflow_managed`.

## Renewed assistant work reopens a done task into its workflow (AT-3098, 2026-11-18)

Karsten commented on a task that was already Done; the assistant started a VM on it and the task
stayed Done for the whole run, and the result never went through the workflow's review. Two holes:
`getDelegatedTaskExecution` returned `null` for a done delegated task (so the chat VM ran outside
the workflow), and nothing looked at `done` for ordinary tasks. `move_task_workflow_step` still
refuses Done on purpose (a chat approval must not reopen anything).

Product decisions (Karsten): **only actual work reopens** a task, meaning a VM job hosted in it
(`execute_task_in_vm` in its chat, `target_task_id`, or a continuation). A plain answer, a status
question or a small tool edit leaves it Done. The task goes to the **first AI step of the working
assistant** (else the first AI step), so every later step, human review included, runs again. With
no AI step (or no workflow) it goes back to **Open** with its owner, who completes it afterwards.

`functions/Tasks/doneTaskReactivation.js` writes the reopen in a transaction that only acts on a
task that is still done (idempotent against retries, concurrent runs and the user reopening it in
the app). The write mirrors the client's `moveTasksFromDone` (rebuilt `stepHistory`/`userIds`,
subtasks, a `workflowStepMove` stamp with the entry time and **no** `runLockId`). The assistant is the
editor (`lastEditorId`, `lastEditorName`), so a `taskStatisticsTransition` marker lets the fan-out
reverse the owner's completion statistics. The fan-out also writes the "changed task to Open" feed,
reopens the delegation receipt and tells the origin conversation.

- **Ordinary task:** `execute_task_in_vm` plans the reopen before the VM brief (the VM is told to
  leave the task open) and writes it only after `startVmJob` succeeds. The VM record therefore
  exists when the trigger enqueues the AI step, so the step parks on it (`task_ai_run_already_active`)
  and, when the job settles, hands the task to the next (human) step without running its prompt.
  A refused launch reopens nothing.
- **Delegated task:** only the workflow starts the VM, so the guard reopens the task into the
  assistant's step, enqueues it at once and returns `workflow_step_reopened`. The VM brief is
  appended to the step prompt (`workflowAiPromptOverride`, mode `append`). Only the owner's request
  reopens it (the workflow runs and pays as the owner); others, and workflows without an AI step,
  get `task_done` and no VM.
- **Enqueue trap:** a done task keeps the history it was completed from. Reopening it onto that same
  last step (the final AI step completed it) used to enqueue nothing, because the step id had not
  changed. `enqueueWorkflowAiRunIfNeeded` now treats a reopen as a landing when the move stamp entered
  that step at the new `completed`. Unchecking the checkbox (`setTaskStatus`, stamp without entry time)
  still runs nothing. A done task never enqueues.

Tests: `functions/Tasks/doneTaskReactivation.test.js`, the AT-3098 blocks of `workflowAiStep.test.js`,
`annaTaskDelegation.test.js` and `assistantHelper.test.js`.

## Assistants know where the tasks they delegated stand, including what happened in their own chats (2026-11-17)

The user hands work to an assistant (Anna, or a project assistant in its chat, AT-3071), the work gets
its own task, and the user often goes on in that task's chat: answers the VM, sends the work back,
approves a step there. The conversation it came from knew nothing of that, and Anna's history only
reaches back to yesterday, so after two days she did not even know the task existed. Every run in a
delegating conversation now gets a "where the delegated tasks stand" block
(`functions/Assistant/delegatedTasksContext.js`).

- **Who watches what:** Anna, the personal assistant, watches all of the user's open delegated tasks
  (`loadAnnaContext`, with the activity notices). A project assistant's chat (`chatTaskTracking`) watches the tasks delegated from the user's conversations with that
  assistant: receipts whose `originAssistantId` is the answering assistant
  (`loadChatDelegatedTasksContext`, started in parallel with the context messages in
  `assistantNormalTalk_optimized.js`, added only when the chat-tracking instruction is).
- **What it holds:** up to 10 tasks, most recently changed first (product decision 2026-11-17). Each has
  its step, who that step waits for, the next step, a VM waiting for an answer or a failed VM run (from
  the `vmInteractionWorkflowStep` hold), the time of the last change, the latest message of the user and
  of the assistant in the task chat (300 characters each), the link, and whether it was delegated from
  this very conversation. The whole block is capped at 9000 characters. It tells the assistant to go on
  in that task (comment, `move_task_workflow_step`, `execute_task_in_vm` with the task as target)
  rather than start the work again, and not to list the tasks unasked.
- **The block itself posts nothing.** The task chat stays the record of the work (Anna's instructions
  say not to duplicate task comments into the conversation). What does appear in the origin
  conversation, Anna's or a project chat: the 📋 review notice, the VM question notice
  (`docs/claude/vm.md`), VM results, and a line for every other workflow step change (next bullet).
- **Step changes reach the parent chat (product decision 2026-11-17).** When a delegated task changes
  its position (another step, back to Open, Done), `notifyDelegationOriginOnStepChange`
  (`delegationReviewNotice.js`, task update fan-out) posts one line in the origin conversation:
  "🔀 AT-1 “…” moved from “Review” to “Merge”; the assistant works on it now.", "↩️ … is back in Open"
  or "✅ … is done". It names the mover from the `workflowStepMove` stamp: "You moved it
  yourself." / "You completed it yourself." for the owner, "Daniela moved it." for another member.
  `classifyStepChange` leaves out what is already said elsewhere: the delegation
  start (`delegationStartedAt`, written by `startDelegatedTaskWorkflow`, equals `completed`), a landing
  on the owner's own step that the owner did not make (the 📋 review notice says it), and a move asked
  for in the origin conversation itself. That last one is the stamp's `fromConversation`, written by
  `move_task_workflow_step` for any conversation other than the task's own chat (not for MCP); all of
  the user's daily Anna threads count as one conversation. The line rings no bell (`userIdsToNotify`
  empty), unlike the review notice. It is claimed per step entry on the receipt
  (`lastStepNoticeKey`), so a redelivered update posts nothing.
- **Who moved it (`workflowStepMove`).** The server's chat moves write the stamp
  (`buildWorkflowMoveUpdate`, with `runLockId` and `fromConversation`), and so does the browser for the
  step picker and the checkbox: `buildWorkflowStepMoveStamp` in `utils/backends/Tasks/tasksFirestore.js`
  (`moveTasksFromMiddleOfWorkflow`, `moveTasksFromOpen`, `moveTasksFromDone`, `setTaskStatus`). A
  stamp counts for a change when it names the step the task landed on and was written with that update
  (`at` differs from the old stamp, which covers a move to Open with no entry time) or entered the step
  at the task's `completed`. The review notice keeps its narrower test (entry time only), and the
  'review' decision uses the same one, so exactly one of the two notices speaks.
  `workflowStepMoveBoundToWriter` in `firestore.rules` (updates only) lets a browser stamp only itself,
  with `runLockId` and `fromConversation` null. It is not applied on create, because a project move
  re-creates the document in the browser with its old stamp. Undo leaves the stamp out
  (`withoutWorkflowStepMoveStamp`): restoring an older stamp would write another member's name or a
  run lock, which the rule refuses, and the whole undo would fail. Rules emulator test: "lets a browser
  stamp only itself"; client: `utils/backends/Tasks/workflowStepMoveStamp.test.js`.
- **Listing:** `delegatedTaskOrigins` where `ownerId == user` and `open == true` (plus
  `originAssistantId == assistant` for a chat). Equality filters only are served by single-field
  indexes, so no composite index is needed (those need an interactive deploy, see `ci-cd.md`). The
  receipt is written with `open: true`. `syncDelegatedTaskOriginOpenState` in the task update fan-out
  sets it to false when the task is done or leaves the delegation, and back to true on a reopen. It reads
  the receipt on every update of a delegated task, which also gives receipts written before the flag
  existed their `open` on their next update. Until then such a task is missing from the block.
- **Scope:** a conversation other members can read gets only its project's tasks, and only those every
  member may see. For Anna that is `projectOnlyContext`. For a chat it is a project with other members
  plus a chat `isPublicFor` that is not just the user; an unreadable chat counts as shared. The task
  must still be the user's own (`task.userId`), delegated, not done, and in a project the user is a
  member of.
- **Never fails a run:** any read error returns an empty block.

## Workflow steps move from chat: "merge it" (AT-2829, 2026-11-16)

`move_task_workflow_step` moves a task to `next`, `back`, `done`, `open` or a named step, or (without
`to`) reads its workflow. It is part of the `update_task` Tools Access toggle (like `get_vm_job` with
the VM tool), never deferred behind tool search (an approval reads like small talk), and offered
over MCP. The rules live in `functions/Tasks/workflowStepMove.js`, not in the prompt:

- **Only a live human turn moves a task.** `askToOpenAIBot` sets `humanTurn` (not for automatic
  comment replies) and the tool also checks that the trigger comment is the user's own and not from
  an assistant. MCP counts as the user. Workflow AI steps, heartbeats, scheduled tasks, email and
  WhatsApp runs never set it, so no unattended run can approve a human step; AI steps keep
  advancing through the runner as before.
- **Who:** the task owner, or the reviewer of the current human step. Only the owner moves a task off
  Open or an AI step, and only the owner skips another member's step.
- **Skips:** one step forward is the approval. Anything further (including Done while steps remain)
  needs `skipSteps`, which the model sets only when the user said so; otherwise the refusal names the
  skipped steps so the assistant can ask. `expectedStepId` refuses a move if the task moved since.
- **Notes** become `workflowAiPromptOverride` with `mode: 'append'`: the run adds them to the step's
  configured prompt instead of replacing it (the popup's replace mode is unchanged). The run
  identity rule still applies: only the owner's note is used in a user workflow.
- The task write mirrors the client movers field for field (forward, rebuild on back, Done, Open,
  subtasks), so the `onUpdateTask` fan-out sees an ordinary move. Reopening a done task stays in the
  app (`moveTasksFromDone` reverses statistics). Feed entries go through the generalized
  `writeMovedInWorkflowFeed` with the acting feed user and direction.

**Trap: the approving chat run is "live work" on the task.** Typed in the task's own chat, "merge it"
lands the task on the Merge step while that chat run still holds its locks, and the AT-2222 rule
above would park the step as `task_ai_run_already_active` and then _skip_ it. The move therefore
stamps `workflowStepMove { stepId, enteredAt, runLockId }`; `getWorkflowMoverRunLockId` returns the
lock only while that move is the task's latest transition. The trigger excludes that one lock from
`findLiveTaskAiWork`, and `runWorkflowAiStep` defers (back to `pending`) instead of parking when only
the approving run is still going, so the step runs after the reply finishes.

**Anna:** when a delegated task lands on its owner's human step, `delegationReviewNotice.js`
(onUpdateTask) posts "ready for you" with Anna's summary of the latest assistant result (never the
result itself, AT-3074, see `vm.md`), the next step and a link in the originating conversation, once per step entry (`lastReviewNoticeKey` on the receipt). Without a
`taskId`, the tool in that conversation picks the one delegated task waiting for the user
(receipts now carry `projectId`/`taskId`) or asks which one. Moves from another conversation leave
a line in the task chat. `loadDelegatedTaskOrigin` returns only the four destination fields because
`runWorkflowAiStep` spreads it into run options.

The task chat context lists the workflow (`formatWorkflowLine`) so "next" has a meaning. Pinned by
`functions/Tasks/workflowStepMove.test.js` and the AT-2829 cases in `workflowAiStep.test.js`.

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
message's run (or its own catch-up) carries this one in its history (for a server-started request only
a newer **user** comment counts, see below). The assistant switched off
(`isAssistantEnabled === false`), a webhook task, a deleted comment or thread, failing the callable's
own `assertObjectAccess`, or a comment older than 24h all skip without taking the lock. Server-written
user turns (WhatsApp daily topic, VM host requests, workflow step prompts) never carry the field, so
they are untouched by construction. Clients older than this change write no field and keep the old
behaviour. Pinned by `functions/Assistant/assistantMissedRunCatchUp.test.js` (including the
`index.js` wiring) and the `recording the assistant run a comment expects` block of
`utils/backends/Chats/chatsComments.outbox.test.js`. `generatePreConfigTaskResultSecondGen` has no
catch-up: its requests carry task-completion semantics a server rerun would have to reproduce.

**Server-started requests and why a check did not run (AT-3059, 2026-11-16).** MCP `ask_assistant`
has no client run at all: it marks its request `startOnServer: true`. Such a request is enqueued with
no grace period, by the tool and by the comment trigger alike (same deterministic task id, so the one
that comes second is a duplicate instead of turning the start into a 90s wait), and its "superseded"
rule ignores newer **assistant** comments: with no client run, nothing else can have answered it,
while goal routing, VM status lines and heartbeats regularly land seconds after a question asked in a
fresh task. Client requests keep "any newer comment" (an answer whose run took no lock must not be
answered twice). Because the task runs once (`maxAttempts: 1`), a check that ends without a lock is
final for that message: it records why on the question, `assistantRunSkipped: {reason, at, detail?}`
(`assistant_disabled`, `no_assistant`, `no_access`, `superseded`, `too_old`, `missing`,
`not_requested`, or `error` when resolving or taking the lock threw). `update`, never `set`, so a
deleted question is not recreated. A run lock always wins over the record. Reproducer: 2026-11-16, a
task created by MCP `create_task` (`isAssistantEnabled: false`, `assistantId: ''`), question
`-P6_Xvj8Jl2ODTMwJnrk`; the queued check ran 14s later and returned 204 in 0.68s with no lock ever
written, and `ask_assistant` reported `starting` forever. Known gap left to the AT-2922 gate:
`threadRunGate.isAssistantRunRequestPending` does not read `assistantRunSkipped`, so a skipped question
still holds other members' next message for up to `PENDING_RUN_GRACE_MS` (150s).

## One assistant turn at a time per thread (AT-2922)

A message that asks the assistant for an answer is **held on this device** while the previous
answer in the same thread is still being produced, and is written into the thread only once that
answer is complete, so the history always reads question, answer, question, answer. Before this,
the comment outbox already stored messages in order, but every send started its own `askToBot` at
once: two runs worked in parallel, the second never saw the first answer, and the answers could
land in either order. "Complete" includes every tool round **and a VM job the answer started in
that same thread** (product decision: the next message waits for the VM too, but **only for a VM
in the same object**). Other conversations are never blocked, and a message that does not ask the
assistant (assistant off, webhook task) is never held.

**A VM handed off to another object does not hold the thread (AT-3058).** After a VM handoff the
model keeps the `askToBotSecondGen` request open, polling `get_vm_job` (`waitSeconds: 30`) to
write its follow-up summary, so the local run of signal 1 below held the next message for the
whole VM run (~6 min in the 16 Nov 2026 Anna report, where the VM ran in a new task), while a
second device, seeing only signals 2/3, sent at once. Now `onVmHandoff` stamps the handoff comment
with `vmHandoffInThread` (the VM host from `execute_task_in_vm` compared with the thread), and the
gate stops counting a local run whose **newest answer** (`assistantRun.triggerMessageId` = the
request id) is a completed handoff with `vmHandoffInThread: false`. The decision is per request
id, so a late completion only settles its own run, and it sticks after the handoff scrolls out of
the 5-comment window; a newer answer of the same run (the `openVmFollowup` comment, `running` for a
few seconds) makes it count again until the request settles. The fix sits in the gate, so Anna and
task/topic chats get it without caller changes. A handoff with `vmHandoffInThread: true` holds
every device until an answer follows it (the VM status comment, which `startVmJob` writes only
after the handoff) or 150 s pass. A handoff without the flag (older server) changes nothing.
Accepted trade-off: the first request's follow-up summary can land after the answer to the next
message; it is its own message.

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
`MessageItemQueuedLayout.test.js`). In the task comment popup (`Comment` in `CommentsList`) the
author row is a fixed 24 px, so the inline note there cut the name and time and ran over the
comment text; it is a `prominent dark` note on its own line between the header and the text,
outside the fade on the two (AT-3037, `Comment.test.js`, `browser-tests/at3037`). A failed
delivery drops `threadGateCleared`/`forceSend`, so a retry waits for its turn again. Out of scope:
WhatsApp (its inbound queue is already serial per user), voice calls and pre-configured prompt
buttons (their runs still hold chat messages in the thread). By design a VM job hosted in a
**different** thread (Anna's contextless dispatch creates its own task) does not hold the
conversation that started it (AT-3058, above). In Anna a job already dispatched no longer marks the
next message "queued" by itself; the gate decides. Pinned by `threadRunGate.test.js`, the `one
assistant turn at a time per thread` block of `chatsComments.outbox.test.js`, the AT-2922 cases in
`commentOutbox.test.js`, `AnnaConversation.test.js` (AT-3058 block), `MessageSendStatus.test.js`,
`useGetMessages.pending.test.js` and the `vmHandoffInThread` assertions in
`functions/Assistant/assistantHelper.test.js`.

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

## Research that hits its limit can still carry out the request (2026-11-11)

`assistantResearchGuard.js` stops a run after 16 lookup calls (or repeated searches, or an oversized
context) and asks for one final reply. That reply used to get **no tools at all**. The daily "User
Description Update" asks Anna to read tasks, goals, notes, contacts and chats and then save the
result. On 2026-11-11 it made 17 reads (`get_chats` and `get_tasks` once per project), hit the
limit, and the final reply could not call `update_user_description`. Anna posted the draft and said
the save "wasn't executed". Nothing failed in the logs; the tell is
`Finalizing bounded research { reason: 'research_call_limit' }` followed by `hasTools: false`.

The final reply now gets every tool that acts (`toolsForFinalReply`) and none that looks things up:
the guard's research set, any `get_`/`read_`/`search_`/`list_`/`find_`/`fetch_`/`browser_` tool,
`load_skill` and `compact_thread_context`. Delegation, external-app and MCP tools and the channel's
`additionalToolSchemas` stay out, because they are open-ended rather than one action.
`FINAL_REPLY_INSTRUCTION` tells the model to make the requested change if it can, and not to claim
an action it did not run. A successful write counts as workflow progress and resets the guard, so
the turn after it has its full tools again. The preflight-recovery request (oversized input) still
goes out without tools. Pinned by `keeps action tools on the final reply…` in
`assistantHelper.test.js` and `offers the final reply only tools that act` in
`assistantResearchGuard.test.js`.

## get_goals is shaped for a model, not mirrored from the document (2026-11-11)

The same run's `get_goals` (status `all`, 331 goals) came to 224k characters. Most of it was empty
fields, the backlog placeholder dates (`Number.MAX_SAFE_INTEGER`) and one entry per done milestone
of a recurring goal. The generic 40k ceiling in `attachmentToolHandoff.js` then kept **only the
first 20 goals**, so the model reasoned over 6% of the list without knowing it. `goalListingContext.js`
now owns the shape. `mapAssistantGoalForToolResponse` leaves out empty and default fields
(`ownerId: 'ALL_USERS'`, `isBacklog: false`, the placeholder dates), keeps the five newest done
milestones plus `doneMilestoneCount`, and trims comments to `amount` and a 300-character
`lastComment`. When a listing is still over the ceiling, or the research guard compacts it,
`compactGoalListing` keeps every goal as an identity line grouped by project before it drops any
goal, and it reports `shownCount`/`listingComplete`. The same applies over MCP, which runs the same
executor.

## One research budget for every run: 48 lookups (2026-11-11)

`assistantResearchGuard.js` ends a run's research after `MAX_RESEARCH_CALLS` lookups since the last
successful write, compacts older tool results to excerpts and asks for a final answer. At 16 that
suited a chat, where the user can say "keep going", but not an unattended run: the Growth Lead's
scheduled daily discovery spent its 16 calls on the playbook, contacts and a few web searches,
stopped after ~100 seconds with 0 of 6 prospects, and the compaction cut the playbook to an excerpt
without the tracked links (its two playbook entries contradict each other for that reason). The cap
is now 48 for every run. A scheduled-only budget was shipped first and replaced the same day: the
product decision is one rule for all runs, no special cases. Every run is still bounded by its wall
clock, and duplicate and repeated-result searches still stop it early. Prompts for research-heavy
work should still save each result once it is verified, because a successful write resets the count.
