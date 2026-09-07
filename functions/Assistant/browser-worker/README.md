# browser-worker — the isolated Playwright service

The only place a browser runs. Deployed as its own Cloud Run **service** (the VM runner next door is
a Cloud Run _job_ — different shape, different lifecycle), reached only by Cloud Functions with a
signed per-call token.

It decides nothing. The allowlist and the limits arrive inside the token
(`../browser/browserWorkerClient.js`), the policy lives in `../browser/browserPolicy.js`, and this
service's job is to apply them at the two points Cloud Functions structurally cannot reach:

- **the network layer**, where redirects and page-initiated navigations happen — every top-level
  document request is re-matched against the allowlist and aborted when it does not match;
- **the DOM**, where `describe` resolves an element and reports what it _is_ without touching it,
  which is the input the policy classifies.

## Files

| file                | role                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------- |
| `server.js`         | three operations: `describe`, `act`, `close`; token auth; usage reporting                            |
| `browserActions.js` | the network guard, the snapshot, the describe step and the six actions                               |
| `sessionStore.js`   | one ephemeral context per run, idle sweeper, session cap                                             |
| `sharedModules.js`  | resolves the token verifier and the allowlist matcher from `./shared` (image) or `../browser` (repo) |
| `Dockerfile`        | build context is `functions/`, so the shared modules can be copied in                                |
| `deploy.sh`         | manual deploy; deliberately not in CI                                                                |

## Isolation

One browser context per browsing run, created with **no `storageState` in and none written out**, so
cookies, localStorage and any session a page hands out die with the context. Two runs — even two runs
of the same user on the same site — never share a logged-in state. Downloads are refused, dialogs are
dismissed, popups are closed and file choosers are cancelled; each of those is a way for a page to
move the run somewhere the policy never looked. Every session has an idle deadline and the process a
session cap, so a wedged page costs one context for a bounded time rather than the container.

## Environment

| key                                  | meaning                                                        |
| ------------------------------------ | -------------------------------------------------------------- |
| `BROWSER_WORKER_SIGNING_SECRET`      | **required**; the same value Cloud Functions mints tokens with |
| `PORT`                               | Cloud Run supplies it                                          |
| `BROWSER_WORKER_MAX_SESSIONS`        | concurrent contexts, default 8                                 |
| `BROWSER_WORKER_IDLE_MS`             | idle teardown, default 3 min                                   |
| `BROWSER_WORKER_HOST_RESOLVER_RULES` | **test hook, never set in a deployed environment**             |

The last one maps hostnames for Chromium and nothing else — it cannot loosen the allowlist, disable
the sandbox or change any other launch behaviour. `browser-tests/at2518` needs it because the
allowlist refuses IP literals and private hosts by design, so a loopback fixture has to be reachable
under a public-looking name.

## Versions

The `playwright` dependency and the `mcr.microsoft.com/playwright:v…` image tag **must be bumped
together**: the image ships the browser binaries for exactly its own version, and a mismatch fails at
launch with "Executable doesn't exist".

## Tests

`browserWorkerGuard.test.js` covers the two rules Functions cannot enforce (redirect containment and
the token). Playwright itself is exercised only by `browser-tests/at2518`, which starts this service
for real:

```bash
npx playwright install chromium
node browser-tests/at2518/run.js
```
