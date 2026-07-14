# Detached VM Cloud Run Job

This container runs the existing `vmJobRunner` outside the Cloud Tasks HTTP
deadline. `startVmJob` launches one execution with `VM_JOB_CORRELATION_ID`; the
runner remains the source of truth for E2B, Firestore lifecycle, Gold and result
delivery.

The product runtime is five hours. Each E2B sandbox lease is capped at one hour;
the runner disconnects the command stream, pauses and immediately resumes the
sandbox every 55 minutes, then reconnects to the same process. The filesystem,
memory and processes survive these handoffs. The Cloud Run task timeout is 5h45m,
leaving 45 minutes for handoffs, E2B cleanup, artifacts, Gold settlement and
notifications.

The Functions launcher records the Cloud Run operation and execution separately.
Ambiguous launch responses are reconciled against the correlation-ID override
before a launch is failed or Gold is refunded. User cancellation calls the Cloud
Run execution cancellation API directly and remains backed by the worker's
Firestore cancellation polling.

All new VM tasks launch the detached Cloud Run Job directly. There is no runtime
feature flag and no Cloud Tasks fallback path.

## Deploy manually

From `functions/Assistant/cloud-run-job`:

```bash
chmod +x deploy.sh
./deploy.sh alldonestaging
./deploy.sh alldonealeph
```

The script deliberately does not copy secrets. Configure the deployed job with
the same runtime values used by Functions (`E2B_API_KEY`, provider API keys,
`VM_PROXY_SIGNING_SECRET`, proxy URL and other required `env_functions` values),
preferably through Secret Manager. The container supports Application Default
Credentials, so do not bake a service-account JSON file into the image.
The committed `.gcloudignore`/`.dockerignore` exclude local env JSON and the
entire `service_accounts/` directory from build contexts.

Required manual setup per environment:

-   Grant `roles/run.developer` on `vm-job-runner` to the
    `firebase-adminsdk-*` service account. The launcher supplies the correlation
    ID as an execution override, which needs `run.jobs.runWithOverrides`; the
    script applies this job-scoped binding.
-   Run the job as that same service account, or grant its runtime replacement the
    existing Firestore, Storage and Secret Manager permissions.
-   Ensure Artifact Registry, Cloud Build and Cloud Run APIs are enabled.
-   Configure the job secrets/env and verify `VM_LLM_PROXY_BASE_URL` points at the
    environment's deployed proxy.
-   Review the regional Cloud Run Jobs concurrent-execution quota before rollout.
    The product still enforces the existing ten-job per-user admission cap; project
    quota is the global safety limit after removing Cloud Tasks dispatch throttling.
    Rollback requires reverting the launcher change and redeploying Functions. Do
    not remove the Cloud Run Job while executions are active.
