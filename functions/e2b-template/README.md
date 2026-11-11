# E2B templates — `alldone-claude-4gb`, `alldone-codex-4gb`

Sandbox templates for the `execute_task_in_vm` assistant tool. The runner
([../Assistant/vmJobRunner.js](../Assistant/vmJobRunner.js)) starts each job from the selected
agent's sized template; names and sizes live in
[../Assistant/vmTemplates.js](../Assistant/vmTemplates.js), which this builder reads too.

**Why they exist.** E2B fixes a sandbox's RAM and vCPU count when its template is built;
`Sandbox.create` cannot change them. E2B's managed `claude` / `codex` templates have 1 GB, which
OOM-kills dependency installs and builds. Each sized template is the managed one unchanged
(`fromTemplate`), built with 2 vCPU / 4 GB. The runner keeps the agent CLIs current at runtime, so
a CLI release needs no rebuild.

**Fallback.** If a sized template is missing in the E2B team behind the key in use, the runner
logs `sized E2B template missing` and starts from the managed 1 GB template, so jobs keep working.
A thread started that way is cold-started again on its next job, so build the templates before
deploying.

This is a **Docker-free** build using E2B's Build System 2.0 — it runs remotely on E2B's
builders. No Docker, no Dockerfile, no `e2b` CLI login.

## Why this dir is isolated (and ESM)

The functions runtime pins **`e2b@^1.x`** because e2b **v2 cannot be loaded in our CommonJS
functions runtime** (its CJS bundle `require()`s ESM-only deps → `ERR_REQUIRE_ESM`; its ESM bundle
hits `Dynamic require of node:url` under raw `node`). The v2 **build** API only runs cleanly under
**`tsx`**, so the build tooling lives here as a separate `"type": "module"` package with its own
`e2b@^2.x` + `tsx` devDependencies. It never touches the runtime, and the whole dir is excluded
from the functions deploy (see `functions.ignore` in `firebase.json`).

## Build (no Docker)

Run it once per E2B team the functions use (staging and production may use different keys):

```bash
cd functions/e2b-template
npm ci

E2B_API_KEY=e2b_*** npm run build            # both agents
E2B_API_KEY=e2b_*** npm run build -- codex   # one agent
```

Rebuilding under the same name replaces the template for new sandboxes; running and paused
sandboxes keep the build they started from. Nothing needs to be configured afterwards.

## Legacy Cloud Tasks IAM grants

New VM runs are launched as the detached Cloud Run Job documented in
[`../Assistant/cloud-run-job/README.md`](../Assistant/cloud-run-job/README.md).
The grants below are retained only for rollback to the legacy `runVmJob` task.

The `execute_task_in_vm` tool enqueues a Cloud Task that invokes the `runVmJob` worker.
Firebase does **not** set up the IAM for this on deploy, so three grants are needed or the
tool fails (and refunds the user's Gold):

1. `roles/cloudtasks.enqueuer` (**project level**) — create the task (enqueue).
2. `roles/iam.serviceAccountUser` on the SA itself — `actAs`, to mint the task's OIDC token.
3. `roles/run.invoker` on the `runvmjob` Cloud Run service — let Cloud Tasks invoke the worker.

Run once per project, **after `runVmJob` is deployed there**:

```bash
./grant-enqueuer.sh alldonealeph     # prod   (done 2026-05-29)
./grant-enqueuer.sh alldonestaging   # staging — run after it deploys from `develop`
```

> **Grant the Firebase Admin SDK SA, not the compute SA.** `firebaseConfig.js` initializes
> admin with `admin.credential.cert(serviceAccountKey.json)`, so every firebase-admin call —
> including the enqueue and the task's OIDC dispatch — authenticates as
> `firebase-adminsdk-*@<project>.iam.gserviceaccount.com`, **not** the Cloud Run/compute SA.
> Granting the compute SA does nothing (we burned ~an hour learning this). The script
> auto-detects the `firebase-adminsdk-*` SA and applies all three grants. It's idempotent.
>
> The errors surface one at a time as you fix them: `cloudtasks.tasks.create` →
> `iam.serviceAccounts.actAs` → (dispatch) `run.invoker`. The script does all three at once.
> Also grant enqueuer at the **project level**, not the queue level — a queue-scoped binding
> was observed _not_ to be honored for firebase-admin's `enqueue()` path.

## Verify

```bash
npx e2b sandbox spawn alldone-claude   # opens a shell in the sandbox
claude --version                       # should print a version
```

> The runtime `ANTHROPIC_API_KEY` is injected per-run by the worker as a sandbox env var —
> do **not** bake it into the image.
