# Detached VM Cloud Run Job

This container runs the existing `vmJobRunner` outside the Cloud Tasks HTTP
deadline. `startVmJob` launches one execution with `VM_JOB_CORRELATION_ID`; the
runner remains the source of truth for E2B, Firestore lifecycle, Gold and result
delivery.

The product runtime is five hours. The Cloud Run task timeout is 5h15m, leaving
15 minutes for E2B cleanup, artifacts, Gold settlement and notifications.

The Functions launcher records the Cloud Run operation and execution separately.
Ambiguous launch responses are reconciled against the correlation-ID override
before a launch is failed or Gold is refunded. User cancellation calls the Cloud
Run execution cancellation API directly and remains backed by the worker's
Firestore cancellation polling.

The migration is guarded by `VM_CLOUD_RUN_JOBS_ENABLED=true` in the Firebase
Functions environment. Until that value is enabled, launches continue using the
retained `runVmJob` Cloud Tasks rollback worker. This makes the code safe to
deploy before the job, IAM, quota and secrets are ready.

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
-   Deploy the Firebase Functions change with `VM_CLOUD_RUN_JOBS_ENABLED` unset
    during the initial infrastructure rollout.
-   After a direct staging execution succeeds, set
    `VM_CLOUD_RUN_JOBS_ENABLED=true` for staging Functions and redeploy them.
    Repeat the staged rollout for production.

Rollback: unset `VM_CLOUD_RUN_JOBS_ENABLED` and redeploy Functions. The legacy
`runVmJob` function is kept temporarily for this purpose. Do not delete the
Cloud Run Job until active executions have settled.
