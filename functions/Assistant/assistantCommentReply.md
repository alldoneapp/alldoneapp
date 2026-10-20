# Automatic replies to assistant comments (AT-2781)

A new assistant-authored comment can start one reply from the target object's
configured assistant when `isAssistantEnabled === true`. The shared handler covers
tasks, topics, notes, goals, contacts, users, skills and assistants. Human comments
continue to use their existing entry points. Webhook tasks keep their existing flow.

The comment creation trigger queues a deterministic Cloud Task. The worker rereads
the comment, target settings, project membership and object visibility, then calls
`askToOpenAIBot` with the existing per-message run lock. It uses a 25-minute run
budget inside the 30-minute Cloud Tasks deadline. Changing/disabling the assistant,
deleting the object/comment or revoking access before execution skips the reply.
Settings changes after execution starts do not cancel an already running answer.

Self-authored comments, assistant-run output (including VM results), status messages,
and tool comments produced during an automatic reply do not start another reply.
The automatic-reply marker propagates to delegated assistants and task/topic comment
tools, including bulk task updates. Other assistants' comments are incoming `user`
turns in the responder's model context; the responder's own output stays `assistant`.

Tool comments record their human requester, whose existing Gold/account limits apply.
Legacy/background comments can use the object's owner/creator only if that account
exists, belongs to the project and can read the object. Without such an account the
comment stays saved and no reply is queued. Missing assistant configuration also skips
execution. Completed, failed and cancelled automatic runs are not restarted on
redelivery; failures remain visible through the existing run-lock/status machinery.
A process crash after partial external side effects cannot guarantee exactly-once
external effects; the existing 65-minute message lease prevents concurrent reruns.

## Verification

Use Node 22/npm 10 with the existing installed dependencies:

```sh
npm test -- --config ci/jest.functions.config.js --runInBand --silent
```

For a focused check, append `--runTestsByPath` and the changed `*.test.js` paths.
No dependency, secret or Firestore index changes are required.

## Deployment notes (deployment requires separate authorization)

Deploy `runAssistantCommentReply` and `onCreateObjectCommentSecondGen` together.
The generic comment trigger replaces `onCreateTaskCommentSecondGen` and retains its
task-priority learning callback. Remove the obsolete task-only trigger as part of
that deployment so tasks have only one comment creation trigger.

The existing Admin SDK service account needs Cloud Tasks enqueue/actAs permissions
and invocation permission on the new `runassistantcommentreply` worker, following
the heartbeat/VM worker setup. Use `firebase-adminsdk-*@<project>`, as described in
`CLAUDE.md`. Validate an enabled and disabled target in staging after deployment;
unit tests do not invoke a live model or Cloud Tasks service.
