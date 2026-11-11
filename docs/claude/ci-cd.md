# CI/CD, deployment and Firestore indexes

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## CI/CD & Deployment

- **GitLab CI/CD**: All deployments are handled via GitLab pipelines (`.gitlab-ci.yml`)
- **Environment secrets**: Stored in GitLab CI/CD variables, not in the repository
- **Branches**: `develop` deploys to staging, `master` deploys to production.
- **Staging deploys only from `develop` (2026-11-09).** `develop` is a protected branch
  (push and merge Maintainers only, no force push), and the staging secrets
  (`GOOGLE_FUNCTIONS_ENV_DEV`, `GOOGLE_SERVICE_ACCOUNT_DEVELOP`,
  `FIREBASE_DEPLOY_SA_STAGING`) are protected variables like their production
  counterparts, so feature-branch pipelines cannot read them. They were readable by every
  branch pipeline before, including those of the VM agents' project token, and the staging
  functions blob shares many values with production (among them the Typesense admin key
  for the search collections both environments use). The manual feature-branch staging
  jobs (`deploy:web-webpack-preview`, `deploy:web-staging-live` and the manual variants of
  `deploy:cloud:functions:staging` / `deploy:cloud:runner:staging`) are gone with it.
  To QA a branch on https://alldonestaging.web.app, a Maintainer brings it to `develop`
  (fast-forward `develop` to master first if it has fallen behind); the develop pipeline
  deploys web, functions and runner. Staging live is last-writer-wins, so say so if others
  are testing. Preview channels are gone too; they never supported Google sign-in anyway
  (their random origin is not an authorized JavaScript origin of the OAuth client).
  `__tests__/CiDeployCredentials.test.js` fails the build if a job reading a staging secret
  can run anywhere but `develop`.
- **Build process**: `ci/replace-envs.sh` injects environment variables during build
- **Firebase projects**: `alldonestaging` (staging) and `alldonealeph` (production)
- **`resource_group` serializes deploys but does NOT order them — production deploy jobs
  run `ci/assertNewestCommit.sh` first.** `workflow.auto_cancel.on_new_commit: interruptible`
  deliberately never cancels a deploy (`interruptible: false`), so a superseded pipeline keeps
  a live deploy job queued; `resource_group` then only guarantees it runs _alone_, not _first_.
  An older pipeline that runs last wins, and every deploy here is last-writer-wins over the
  whole environment. This is not theoretical: `firebase deploy --only functions --force` treats
  the deployed source as the desired state and **prunes functions absent from it**, so on
  2026-08-10 a stale master pipeline deleted two just-shipped callables
  (`getVmAgentModelOptions`, `setDefaultVmAgentModel`) and reverted `getVmAgentSettings` to
  pre-feature code seventeen minutes after a newer pipeline created them — with every Cloud
  audit entry reading `ok`, because nothing failed from Firebase's point of view. The guard
  compares `CI_COMMIT_SHA` against the live branch tip **at deploy time** (not pipeline start —
  a newer commit routinely lands while an earlier stage is still building) and exits `75` when
  superseded. Each guarded job declares `allow_failure: exit_codes: 75`, so a correctly-skipped
  deploy is visible in the pipeline graph without turning the pipeline red — it deliberately
  does not exit 0, because a deploy job reporting success without deploying is the same trap as
  the old `xargs -r` no-op in `test:web:changed`. It fails **closed** (exit 1) when the tip
  cannot be read: a skipped deploy is fixed by retrying the job, an out-of-order one silently
  reverts production. `ALLOW_STALE_DEPLOY=1` forces a deliberate rollback through.
  `__tests__/CiDeployGuard.test.js` fails the build if a job that deploys on the default branch
  lacks the guard, the allowed exit code, `interruptible: false` or a `resource_group`, so a new
  production deploy job cannot quietly opt out.
- **Production deploy scope comes from what SHIPPED, not from what the push touched
  (`ci/deployScope.sh`).** Scoping a deploy with `rules: changes:` asks "did _this_ push
  touch `functions/`", which stops being the right question the moment the guard above starts
  skipping superseded pipelines — the two combine into a hole that loses a release and closes
  silently. Push A touches only `functions/`; push B lands three minutes later touching only
  `components/`; A's pipeline is superseded and skips its functions deploy, and B's pipeline
  **never contained a functions deploy job at all**, because B's own diff has no `functions/`
  path. Nobody deploys A. Every job in both pipelines is green and the only symptom is
  production running one merge behind. Master takes ~11 pushes/day with a median gap of 26
  minutes and **28% landing within 10 minutes of another**, so this is the ordinary case: 45
  days of history contain ~34 functions-side and ~30 web-side occurrences. Each target now
  keeps a marker — a git tag `deployed/<target>` moved **only after a successful deploy** — and
  its scope uses `git diff <marker> <HEAD>` against `ci/deploy-scope/<target>.paths`
  (Functions use the dependency graph described below). That is
  inherently catch-up: whatever a skipped pipeline left behind is still missing from the
  marker, so the next pipeline ships it alongside its own change, and a target whose paths
  have not moved is still skipped, so the steady-state deploy count is unchanged. `compute`
  runs once per pipeline (`deploy_scope`) and publishes `deploy-scope.env`, so a web build, its
  tests and its deploy can never disagree about whether they are shipping — which is why
  `build_web_production` and `test:web:full` are no longer `changes:`-scoped on master either
  (they feed `deploy:web` through `needs`, so being absent from the catch-up pipeline would
  make `needs` unresolvable). Exit `76` means "already up to date" and the CI wrapper exits successfully;
  only superseded exit `75` is an allowed warning. **Every uncertain path resolves to deploying**, never to
  skipping: a redundant deploy is visible and cheap, a silently skipped one ships nothing.
  Note a job with an explicit `needs` list loses the default "artifacts from all earlier
  stages", so it must name `deploy_scope` or it silently falls back to deploying always.
  Markers are pushed with `CI_JOB_TOKEN` ("Allow Git push requests to the repository" is on),
  `DEPLOY_MARKER_TOKEN` remaining an explicit override. Tag pushes cannot trigger pipelines
  here — the `workflow` rules only admit pipelines that have `$CI_COMMIT_BRANCH`. Pinned by
  `__tests__/CiDeployScope.test.js`, which also fails the build if
  `ci/deploy-scope/web-production.paths` drifts from the `*web-relevant-paths` anchor.
- **A production marker is only believed when a default-branch pipeline signed it
  (security audit 2026-11, NV-01).** A marker can only make a deploy smaller, so a forged
  one holds back a reviewed fix: `deployed/firestore-rules-production` pointed at any
  commit with master's rules (the MR source commit is one) made the rules release report
  "already deployed", and an old `deployed/github-mirror` would have replayed pre-cutoff
  history onto the public mirror. The tags cannot be GitLab-protected, because a protected
  tag can never be moved again and CI moves them on every deploy, and anyone with Developer
  access (the VM-agent bot token included) or a branch job token can push them. So
  `record` writes an annotated tag whose message (target, commit, ref, pipeline, job) is
  HMAC-SHA256-signed with the protected, masked variable `DEPLOY_MARKER_SIGNING_KEY`, and
  only from a protected default-branch pipeline; `verified_marker` rejects a lightweight
  tag, a bad signature, another target's marker and a commit that is not an ancestor of the
  one under test (deepening the shallow clone as needed). Changes are read from every commit
  in `marker..HEAD` as well as the tree diff, so replaying an older genuine marker after a
  revert still deploys (for Functions those files go to the selector as `rangeChanged`). A
  rejected or missing production marker means **deploy**; the old push-range fallback is
  gone for production, since deleting a tag would have reopened the hole. Without the key,
  `compute` and `functions-plan` fail on master naming the variable, instead of deploying
  everything (Functions in full) on every push. `functions-staging*` markers stay unsigned:
  feature branches write them and staging is branch-reachable anyway. The first master
  pipeline after this shipped found only unsigned markers and deployed every target once.
  `ci/github-push.sh` additionally appends only when the cutoff commit is an ancestor of
  the last mirrored one and the mirror tip carries that commit's tree; otherwise it rebuilds.
  `fetch_marker` no longer uses `--depth=1` in a complete clone, where it grafted a shallow
  boundary at the marker and cut off the mirror's cutoff commit. Pinned by
  `__tests__/CiDeployMarkers.test.js` (real git: replay, forgery, copied and non-ancestor
  markers, shallow clones, HMAC tools agreeing) and the marker case in
  `__tests__/CiFunctionSelection.test.js`.
- **Firebase deploys use one service account per environment, never a login token
  (security audit 2026-11, NV-32).** Everything used to authenticate with one
  `firebase login:ci` token (`GOOGLE_FIREBASE_DEPLOY_TOKEN`) that could deploy both projects
  and that every feature-branch pipeline could read. Every job that runs firebase-tools now sources
  `ci/useFirebaseDeployCredentials.sh production|staging`, which sets
  `GOOGLE_APPLICATION_CREDENTIALS` and `FIREBASE_DEPLOY_PROJECT` and unsets
  `FIREBASE_TOKEN` / `GOOGLE_FIREBASE_DEPLOY_TOKEN` (firebase-tools prefers a token over
  ADC). `FIREBASE_DEPLOY_SA_PROD` (protected, File variable) is a key for a deploy account
  with roles on `alldonealeph` only, and the helper also refuses it outside a protected
  default-branch pipeline; `FIREBASE_DEPLOY_SA_STAGING` (protected since 2026-11-09, see above) is a key
  for an account with roles on `alldonestaging` only. There is no fallback to the old token: a
  missing variable fails the job with its name. The helper checks the key's `project_id`
  and `client_email` domain, so a production key in the staging variable is refused.
  `__tests__/CiDeployCredentials.test.js` fails the build if a job running firebase-tools
  on a non-default branch selects production (or vice versa), if `--token` or the old
  variable comes back, or if a job other than `deploy:cloud:runner:production` touches
  `GOOGLE_SERVICE_ACCOUNT_MASTER`. The runner jobs still authenticate gcloud with the
  runtime keys (`GOOGLE_SERVICE_ACCOUNT_MASTER` protected, `_DEVELOP` staging-only).
- **No service-account key is written into `functions/` any more (NV-08).** Both functions
  deploy jobs wrote `GOOGLE_SERVICE_ACCOUNT_DEVELOP` and `_MASTER` into
  `functions/service_accounts/`, and firebase-tools zips the whole functions directory
  minus `firebase.json` `functions.ignore` (it does NOT read `functions/.gcloudignore`), so
  every deploy uploaded both keys into the target project's function source, the staging
  one included. The deployed runtime never used them (`firebaseConfig.master.js` /
  `.develop.js` use ADC). The jobs write no key now, and `functions.ignore` excludes
  `service_accounts/`, key-shaped file names and `tmp_project_name` as well, so a local
  `firebase deploy` from a machine with keys in that folder is covered too.
- **GitLab protection state (2026-11-08).** `master` is protected: push and merge
  Maintainers only, no force push. `GOOGLE_SERVICE_ACCOUNT_MASTER`,
  `GOOGLE_FUNCTIONS_ENV_PROD`, `GITHUB_TOKEN`, `GITHUB_TOKEN_ALLDONEAPP` (and the new
  `FIREBASE_DEPLOY_SA_PROD`, `DEPLOY_MARKER_SIGNING_KEY`) are protected variables, so only
  master pipelines see them; staging variables stay unprotected because feature-branch QA
  jobs use them. The container registry lets only Maintainers push or delete tag
  `^latest$`. `deployed/*` tags are deliberately NOT protected (see the marker note).
  Earlier notes in this repo that said there were no protected branches (for example in
  `TYPESENSE_MIGRATION.md`) describe the state before that date.
- **Functions deploy only affected exports.** `ci/selectFunctionsDeployment.js` parses
  committed `functions/index.js`, follows entrypoint helpers and transitive local imports,
  and compares both trees against `deployed/functions-production` (or `functions-staging`).
  Shared modules select every importing export, including imports outside `functions/`.
  Unreferenced tests/docs and unrelated frontend changes do not select backend functions.
  `functions-deploy-scope.json` records names and reasons; partial selections deploy in
  batches of at most ten via `ci/runFunctionsDeployment.js`. The isolated, pinned parser
  dependencies live in `ci/function-scope-tools/`.
  Selection refreshes inside the serialized Functions job, since an earlier deployment
  can finish after the pipeline's initial scope calculation. Before Firebase starts,
  `functions-begin` must successfully record `deployed/<target>-attempt`. If that attempt
  differs from the last verified deployment, the next run reconciles all functions,
  including a revert after a partially completed deployment. Success advances the normal
  marker only after per-selected-function completion and the full live export inventory
  are verified. Thus a failed batch never advances the successful marker.
  Missing baselines/artifacts, removed exports, package/runtime/configuration changes,
  unmapped runtime assets and `FUNCTIONS_DEPLOY_ALL=1` use full deployment. Unresolved
  dynamic imports conservatively include their callers on possible source changes;
  unsupported export syntax fails analysis instead of silently omitting a function.
  CI stamps `functions/ci-deployment.json` into the uploaded package so runtime-only
  changes cannot be skipped by Firebase's source hash. This file and the scope manifest
  are generated and ignored by git. Environment changes outside git require
  `FUNCTIONS_DEPLOY_ALL=1`; repository analysis cannot detect changed CI secret values.
  **A deploy that exits 0 can still have skipped a whole group of functions, so
  `ci/runFunctionsDeployment.js` redeploys once.** firebase-tools 13.29.3 deploys in
  parallel groups keyed by region and memory, and an exception escaping one group is only
  written to its debug log (`fabricator.applyPlan`, "This should never happen"). On
  2026-11-09 a full deploy lost the 1, 2 and 4 GiB groups (the same 67 functions on
  production and staging) and reported success. The script streams Firebase's output live
  and keeps a copy. It then reads the completed results with the verification's own parser
  (`completedFunctionNames`) and reruns, once, only the batches that hold a function without
  a result. On a full deploy that is a second `--only functions`, which skips every function
  already current by its source hash. More than `MAX_REDEPLOY_NAMES` missing is not this
  failure and is left to the verification step, which still fails the job for anything
  missing after the retry. Pinned by `__tests__/CiFunctionSelection.test.js` and a
  real-process case in `__tests__/CiFirebaseFunctionsDeployment.test.js`.
- **A batch that stops on a Google API quota (HTTP 429) is retried after the quota minute.**
  A partial production deploy runs one `firebase deploy` per 10 functions, and each run looks the
  Firestore database up again for its Firestore triggers. On 2026-11-11 the fourth batch hit
  `firestore.googleapis.com ... databases/(default)` "Database Operations Per Minute" and exited
  1 before changing anything, which failed the job (pipeline 9668). firebase-tools retries the
  Cloud Functions mutation 429s on its own (they show up as warnings), but not this one.
  `ci/runFunctionsDeployment.js` now waits `QUOTA_RETRY_DELAY_MS` (65s) and reruns the same batch,
  at most `QUOTA_RETRIES` (2) times, only when the failed output contains
  `HTTP Error: 429, Quota exceeded`; any other failure still stops the job at once. Re-running is
  safe because functions already current are skipped by source hash. Pinned in
  `__tests__/CiFunctionSelection.test.js`.
- **`resource_group` process mode is an API-only setting and defaults to `unordered`.** With
  the guard and the markers in place the default is safe (an out-of-order job skips and the
  next pipeline catches up), but `newest_first` gets the current commit live sooner and wastes
  fewer queued slots:
  `curl --request PUT --header "PRIVATE-TOKEN: <token>" "$CI_API_V4_URL/projects/<id>/ci/resource_groups/functions-production-deploy" --data "process_mode=newest_first"`
  — repeat per resource group (`web-production-deploy`, `runner-production-deploy`,
  `github-mirror`). It cannot be set from `.gitlab-ci.yml`.
- **The GitHub mirror is its own job (`mirror:github`), not part of the production build.**
  It used to run in `build_web_production`'s `before_script`, which gave that ~9-minute build
  an external side effect and therefore `interruptible: false` — so **every** superseded master
  push paid for a full production build purely to reach the mirror. Splitting it out is the
  single biggest CI-capacity win available here, since 28% of pushes are superseded within ten
  minutes. It also now runs on every master push rather than only web-relevant ones: the mirror
  is a copy of the repository, so the old scoping meant a functions-only push never reached
  GitHub until some later commit happened to touch web paths. `ci/github-push.sh` appends only
  new commits (keyed on the `github-mirror` marker) using `git commit-tree`, instead of
  replaying all 2,524 post-cutoff commits through an orphan branch on every deploy; it falls
  back to a full rebuild and force-push whenever the mirror is not where the marker claims, so
  it is self-correcting. `commit-tree` also fixed a latent bug: the old
  `git checkout <c> -- . && git add -A` loop restored files but never removed them, so the
  public mirror had been accumulating files master had deleted.
- **CI images bake `node_modules`, so a branch that changes dependencies needs its own
  image.** `build_base` (node:12, `npm ci` on the v1 lockfile) and `build_web_bundler`
  (node:22 tooling + the app tree copied from the base image) are built by the
  `modules_cache` / `web_bundler_cache` kaniko jobs. `build_web_webpack_check` and
  `test:web:changed` do **not** install anything — they `ln -s /app/node_modules` from
  the image. Before 2026-08-05 the cache jobs only ran on develop/master, so any branch
  bumping a dependency compiled and tested against the _previous_ lockfile's tree and
  failed with unresolvable imports (the firebase 8 → 12 branch: `Can't resolve 'firebase/compat/app'`) while being green locally. Now a feature branch whose
  dependency manifests differ from master builds its own images tagged
  `:branch-$CI_COMMIT_REF_SLUG`, selected by the consuming jobs through a rules-level
  `APP_IMAGE_TAG` (default `latest`); `:latest` is still only ever written from
  develop/master, because master builds from it. The `branch-` prefix is a security
  boundary (NV-31): with the bare slug, a branch named `latest` (or anything GitLab slugs to
  it, like `LATEST`) pushed its own `node_modules` over the images master's production
  build and gates run in. `__tests__/CiImageTags.test.js` holds it. Two consequences: the branch's first
  pipeline is slow (full `npm ci` + two image pushes), and each such branch leaves an
  image in the registry — bound that with a tag cleanup policy.
- **`test:web:changed` runs only what a branch changed, so read the selection line
  before trusting a green tick.** `ci/selectTargetedJestFiles.js` diffs
  `origin/master...HEAD` and prints a `Targeted Jest selection: N file(s) …` summary to
  stderr; `N` is the honest measure of what the job covered, not the green tick. Two
  ways it legitimately selects nothing: a branch that changed no web-relevant JavaScript,
  and a branch **already merged into master** — the pipeline for the last branch commit
  often starts before the merge and fetches master after it, at which point the branch
  diff is empty by definition and nothing is tested (`test:web:changed` never runs on
  master, so no other job covers those commits either; re-run the job before merging, not
  after). Every other outcome is a failure: the selector exits non-zero on an unresolvable
  base ref (3), a missing merge base (4) or a failed diff (5), and the job fails on it.
  Keep it that way — the original bug was `selector | xargs -0 -r npm test`, where
  `xargs -r` skipped the run on empty input and the pipeline reported only xargs' status,
  so a crashed selector and a clean run were indistinguishable. Check exit statuses
  explicitly rather than through `set -e`; the runner's shell is busybox `sh`.
- **`ci/ensureMergeBase.sh` exists because the CI clone is shallow.** GitLab clones with
  `git depth 50` and a plain fetch of the default branch inherits that boundary, so a
  branch whose fork point is older has no common ancestor locally and the whole selection
  collapses. The script fetches the default branch and the branch under test, then deepens
  (250 → 1000 → `--unshallow`) only until `git merge-base` resolves, so the usual recent
  branch pays nothing.
- **The registry cleanup policy must always keep `latest`.** Branch-scoped images
  (`build_base:branch-<ref-slug>`, `build_web_bundler:branch-<ref-slug>`) accumulate one per
  dependency-changing branch, so a cleanup policy is needed — but the policy this project
  had was `name_regex: ".*"` with `name_regex_keep: null`, i.e. **nothing protected**,
  including `latest`. That is a live hazard rather than a theoretical one: GitLab reports
  a tag's `created_at` from the _image config_, not the push time, so `build_base:latest`
  read as 2022-04-29 and counted as far "older than" the threshold; only `keep_n`
  ordering against other equally-stale tags was keeping it. Deleting `build_base:latest`
  would break every job that pulls it, and **it would not self-heal** — `modules_cache`
  only rebuilds when `package.json`, `package-lock.json` or `ci/Dockerfile_base` changes.
  The policy is now `name_regex_keep: ^latest$`, `older_than: 14d`, `keep_n: 5`. Delete a
  merged branch's tags by hand (`DELETE /projects/:id/registry/repositories/:repo/tags/:tag`)
  rather than loosening that. All four image repos now hold only `latest`: the commit-SHA
  tags left behind by a retired CI convention (builds of November 2021 commits, present in
  both `build_base` and `build_functions`) were deleted, having been checked for distinct
  manifest digests and zero references. The `<repo>/cache` sub-repositories are kaniko's
  layer cache and are meant to churn — the policy prunes them, and they simply rebuild.
- **Never fix a missing dependency by copying packages into `node_modules`.** Install
  through the lockfile. Example of why: firebase 12 keeps root `tslib` at 1.11.1 while
  nesting `tslib` 2.8.1 inside 29 of its 44 `@firebase/*` packages; a flat copy hoists
  2.8.1 to the root and breaks the 1.x consumers (Stage 0 hit the inverse of this, where
  root tslib 1.11.1 shadowed the nested 2.x and threw `__spreadArray is not a function`).
- **The runner image jobs run on the floating upstream `google/cloud-sdk:slim`, which has
  no `python3` on PATH since SDK 592.0.0 (2026-11-03).** Its Dockerfile asserts
  `! command -v python3`, and gcloud uses its own bundled Python. The old inline check
  `python3 -c … 2>/dev/null || echo "not valid JSON"` therefore turned "python3: not found"
  into "env_functions.json is not valid JSON", and `deploy:cloud:runner:production` failed
  on a valid secret while the Functions deploy in the same pipeline read it fine.
  `ci/validateJsonFile.sh` uses `python3`, `$CLOUDSDK_PYTHON`, the bundled Python and then
  `node`, in that order. A missing interpreter exits `2` with that diagnosis, and invalid
  content exits `1` with only a position. It never prints content, because V8's
  `JSON.parse` message quotes it. Never hide a check's stderr when the checker itself may
  be missing. Pinned by `__tests__/CiValidateJsonFile.test.js`.

## Firestore indexes (`firestore.indexes.json`)

- **Never deploy indexes with `--force`.** `firebase deploy --only firestore:indexes` treats the file as the _desired state_: `--force` deletes every live composite index **and field override** the file omits. The file drifted to 25 indexes / 2 field overrides while production held 228 / 71, so a forced deploy would have dropped ~200 indexes plus 69 single-field **index exemptions** — the exemptions are the sharper hazard, since removing one makes Firestore _start_ indexing a large text field (`comments.comment`, `notes`, `entries`), causing write amplification and possible "index entry too large" write failures.
- **There is no safe automated deploy, so CI only checks.** Dropping `--force` does _not_ give you a create-only deploy in CI: with `--non-interactive`, firebase-tools' `confirm()` helper **throws** ("Pass the --force flag to use this command in non-interactive mode") as soon as any live index is missing from the file, and it throws _before_ creating anything. Production permanently has at least one such index (the `tasks` index on `__name__` alone, which the file format cannot express), so a non-interactive deploy can only ever fail — an earlier version of `check:firestore:indexes:production` did exactly that. The jobs in `.gitlab-ci.yml` are therefore **read-only drift checks**.
- **To actually create missing indexes, deploy interactively** and answer **no** when it offers to delete the undeclared ones: `firebase deploy --only firestore:indexes --project <projectId>`. Interactively the confirm defaults to false, so it creates what is missing and then skips the deletions. That is the supported way to give staging the indexes it lacks.
- The file **mirrors production** (218 indexes + all 71 field overrides), verified to require zero creates and zero field-override patches under both firebase-tools 13.29.3 and 15.11.0.
- **Check before deploying**: `node ci/check-firestore-indexes.js <projectId>` diffs the file against a project's live state and prints what a deploy would create, patch, or (with `--force`) delete. `--warn-only` reports without failing; `--strict` also reports the deliberately-excluded junk. Regenerate the file with `firebase firestore:indexes --project alldonealeph`.
- **Strip `__name__`, and never blindly.** The API returns a trailing `__name__` field the file format does not list. Both CLIs expect it absent, but for opposite reasons: the pinned **13.29.3 strips it from the live side**, while **15.x re-appends an implicit one to the file spec**, ordered like the last _ordered_ field. So `__name__` may only be dropped when its direction equals that implied value — otherwise 15.x sees a mismatch and delete+recreates the index. Also strip `density` (13.29.3 has no support for it; `SPARSE_ALL` is the default anyway).
- **Two live indexes are unrepresentable and intentionally omitted**: 9 on collections named with Firebase push IDs (a path-templating bug; those collections hold 0 documents) and one `tasks` index whose only field is `__name__ DESCENDING` — 13.29.3 renders it as zero fields, and it is redundant because Firestore indexes `__name__` implicitly. `check-firestore-indexes.js` ignores both shapes unless `--strict`.
- **`--only firestore:indexes` does not publish rules.** It compiles `firestore.rules` to validate them, but `release` is gated on `context.firestoreRules`, which that flag clears. `--dry-run` runs only the prepare phase, so it validates the file without any API writes — but it does _not_ print a create/delete plan; use the check script for that.
- **Staging is not a superset of production.** It holds ~30 indexes production lacks, including 15 with hardcoded user IDs baked into field paths (`dueDateByObserversIds.<uid>`, plus malformed dot-less variants) created ad hoc from the console. Never fold those into the file — they would be created for two arbitrary users in production.
- `.firebaserc` defaults to **`alldonestaging`**, so an index command without `--project` targets staging. Always pass `--project` explicitly.
- **Swapping the access field of a query silently orphans every composite index it had (the
  `readerIds` rollout, 2026-08-28).** A composite index is keyed on its exact field set, so when
  "Harden Firestore access rollout" rewrote every list query from `isPublicFor array-contains-any`
  to `readerIds array-contains`, each rewritten query needed a brand-new index and the ~55 `isPublicFor`
  ones covered nothing. Only the views exercised during the work got theirs; the Done tab shipped
  without its four and was **empty in production for five days** — `failed-precondition` in the
  console, nothing in CI, because the drift check only compares this file against the live set and
  the missing ones were absent from both. Two facts decide which queries need one, both verified
  against production with a read-only `runQuery`: Firestore **merges `array-contains` with any
  number of equality filters on its own**, so `readerIds` + `==` clauses need no composite; a
  **range, a `!=`, or an `orderBy`** on top of it does, and direction counts (`completed ASC` does
  not serve `orderBy('completed','desc')`, and an inequality with no explicit order needs ASC).
  When rewriting a query's filter field, derive the new index list from the old one before
  shipping; `__tests__/Firestore/firestoreRequiredIndexes.test.js` pins the fifteen `readerIds`
  shapes the client uses. Note the per-user access keys (`roleIdsVisibleTo.<readerId>`,
  `followedByVisibleTo.<readerId>`, `backlinkIdsVisibleTo.<readerId>`) can **only ever be the
  sole clause** of a query: a composite index on a map key is one index per user, which is not a
  thing. The observed-tasks branch of `getOpenTasksQuery` (`utils/backends/openTasks.js`) keeps
  its `dueDate` filters inside the assigned-tasks `else` branch for exactly that reason and
  buckets observed tasks by date in memory — do not "tidy" the date filters out of the `else`.
