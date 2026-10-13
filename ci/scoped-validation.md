# Scoped deployment and validation

Functions compare exported handlers and transitive runtime imports with the last verified deployment, including changes left behind by superseded pipelines. Formatting, comments and test-only changes do not redeploy Functions. Pipeline test-job edits do not redeploy Functions unless their deployment environment changes. Runtime dependencies, unknown baselines, unresolved dependencies and partial-deployment recovery keep the conservative full selection.

Web and backend gates run Jest's affected suites plus source-reading tests whose filesystem inputs changed. Unknown source reads retain their own suite. Global test configuration, removed dependencies, failed discovery or missing mappings keep full validation. Deployments no longer trigger a full web run merely because 24 hours elapsed, or append unrelated smoke suites.

Function deployment waits for backend validation and applicable web validation. A verified backend no-op plan skips dependency installation and tests. Firestore emulator tests have a separate tested marker; they run when their rules, fixtures, emulator configuration or test runtime change. Before the first marker, the last gated rules deployment is a valid baseline. No verified baseline means full rules validation.

Writing prompts and the shared execution allowlist are separate modules. After this split is deployed, a writing-prompt-only edit selects the three writing Functions and the two writing suites. Deploying the split itself also updates callers of the changed shared helper import.

The existing newest-commit guard, serialized deployment, batches of at most ten Functions, attempt marker and per-function deployment verification remain in place.
