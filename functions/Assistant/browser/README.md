# Browser tools (`browser_*`) — developer guide and threat model

The assistant can open a page in a real browser, read it, interact with it and screenshot it. This
directory is the Cloud Functions half: configuration, policy, approvals, limits, evidence and the
audit trail. The browser itself runs in `../browser-worker`, a separate Cloud Run service.

**Status: not enabled anywhere.** Nothing is deployed, no environment carries the configuration, and
with no configuration every call is refused with a message naming what is missing. Switching it on
is a deliberate operational act — see _Enabling it_ below.

## Why not just `fetch_url`

`fetch_url` reads a page's HTML. It cannot run a site's JavaScript, cannot use a date picker, cannot
follow a "check availability" flow, and returns nothing useful for a page that renders client-side —
which is most ticketing, booking and event sites. That is the gap: "does that event still have
tickets for the 15th" is a question you answer by _using_ the site.

Keep using `fetch_url` for anything a plain read answers. It is faster, cheaper, has no session and
no allowlist.

## Architecture

```
model
  └─ browser_navigate / _inspect / _click / _type / _wait / _screenshot   (toolSchemas.js)
       └─ isToolAllowedForExecution                    ← one Tools Access key: browser_automation
            └─ executeToolNatively                     (assistantHelper.js)
                 └─ executeBrowserTool                 (browserSession.js)  ← the only entry point
                      ├─ browserConfig      is browsing configured, and for which hosts
                      ├─ browserAudit       run + step record, budget charged in one transaction
                      ├─ worker: describe   what IS this element (never touches it)
                      ├─ browserPolicy      allow / deny / requires_approval
                      ├─ browserApprovals   grant lookup, or raise a request and stop
                      ├─ worker: act        perform the action
                      ├─ browserEvidence    screenshot + snapshot → Storage, hashed
                      └─ browserRedaction   what the model sees, what the record keeps
```

The same path serves the in-app assistant, the WhatsApp bridge and the MCP server, because all three
reach `executeToolNatively`. There is no second implementation and no client-side browser.

### The ordering that matters

For `click` and `type` the worker is asked to **describe** the element before anything touches it,
and the policy classifies _that_ — role, accessible name, input type, the enclosing form's method and
action, the labels of the form's submit buttons, the page URL. Nothing the model wrote is an input to
the decision.

This is the answer to "a generic click bypasses the gates". There is no argument the model can pass
that makes a _Jetzt kostenpflichtig bestellen_ button look like a link, because the model does not
describe the button — the DOM does.

## The six actions

| tool                 | what it does                                         | gate                                          |
| -------------------- | ---------------------------------------------------- | --------------------------------------------- |
| `browser_navigate`   | opens a URL, returns text + elements, starts the run | allowlist; approval for side-effect URLs      |
| `browser_inspect`    | fresh snapshot with a `ref` per interactive element  | none (read-only)                              |
| `browser_click`      | clicks one element by `ref`                          | describe → policy → approval                  |
| `browser_type`       | types into one field, optionally submits             | describe → policy → approval; secrets refused |
| `browser_wait`       | waits for time or a selector                         | none (read-only)                              |
| `browser_screenshot` | captures the page, stores it as evidence             | none (read-only)                              |

A run is scoped to one thread (`browserSessions/{projectId}__{objectId}`), the same shape as a VM
session. `browser_navigate` opens it; everything else needs it open.

## Security controls

| control                            | where                                     | behaviour                                                                                                              |
| ---------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Domain allowlist, **default deny** | `browserAllowlist.js`, `browserConfig.js` | empty list ⇒ nothing is reachable. No IPs, no private hosts, no bare `*`, no single-label hosts                        |
| Redirect containment               | worker `browserActions.js`                | every document request incl. every redirect hop is re-matched; an off-allowlist hop is aborted                         |
| Run limits                         | `browserLimits.js`                        | steps, navigations, screenshots, requests, bytes, wall clock — charged in the step transaction, persisted on the run   |
| In-page limits                     | worker                                    | request/byte caps, redirect cap, per-step timeout, idle teardown                                                       |
| Ephemeral context                  | worker `sessionStore.js`                  | one context per run, no `storageState` in or out, downloads refused, dialogs dismissed, popups closed                  |
| No credentials anywhere            | policy + worker                           | a credential-shaped string is never typed outside a credential field; nothing is persisted between runs                |
| Approval gates                     | `browserPolicy.js`, `browserApprovals.js` | login, upload, booking, payment, submit/publish, delete, external message — refused until the requesting user approves |
| Bypass prevention                  | `browserSession.js`                       | describe-then-classify; an unresolvable element is a refusal, not an unclassified click                                |
| Audit trail                        | `browserAudit.js`                         | one run doc + one step doc per tool call: decision, category, evidence for the decision, approval id, usage, timings   |
| Evidence                           | `browserEvidence.js`                      | screenshot + DOM/AX snapshot in Storage with SHA-256, referenced from the step                                         |
| Redaction                          | `browserRedaction.js`                     | credentials out of model-facing text; credentials **and** PII out of records; typed text never stored                  |
| Worker authentication              | `browserWorkerClient.js`                  | per-call HMAC token, 2-minute TTL, carrying the allowlist and limits so the worker cannot widen them                   |

### Categories that always pause

`login`, `file_upload`, `booking`, `payment`, `submit_publish`, `delete`, `external_message`.
Detected in English, German and Spanish from the observed element, its form and the URL path.
An unrecognised form submission is `submit_publish` — i.e. it pauses too.

**One carve-out:** a GET form whose fields are search-shaped is `search_submit` and runs without an
approval. It changes nothing on the far side, and without it the feature cannot answer the question
it exists for. It never applies when a sensitive category also matched, and a project can switch it
off with `browserAutomation.allowSearchSubmit: false`.

### What an approval is

A grant against the policy **signature** — `(action, category, host, element shape)` — created only
by `respondToBrowserApprovalSecondGen`, only by the user the request was raised for, defaulting to
single use, expiring after 15 minutes and never outliving the run. Approving "book that table" can
never be replayed as "delete the account". A denial sticks for the rest of the run, so the model
cannot loop on the dialog.

## Configuration

Environment (goes in `GOOGLE_FUNCTIONS_ENV_DEV` / `_PROD`, **and** must stay listed in
`functions/envFunctionsHelper.js` — that file is an allowlist, not a passthrough):

| key                             | meaning                                                    |
| ------------------------------- | ---------------------------------------------------------- |
| `BROWSER_WORKER_URL`            | https URL of the Cloud Run worker                          |
| `BROWSER_WORKER_SIGNING_SECRET` | shared HMAC secret; the same value on the worker service   |
| `BROWSER_ALLOWED_DOMAINS`       | comma/space separated allowlist available to every project |

Per project, on `projects/{projectId}.browserAutomation`:

```js
{
  enabled: true,                        // false switches browsing off for this project
  allowedDomains: ['eventim.de', '*.kulturhaus.example', 'shop.example/events'],
  allowSearchSubmit: true,
  limits: { maxNavigations: 5 },        // may only NARROW the defaults
}
```

Allowlist syntax: `example.com` (apex + subdomains), `*.example.com` (subdomains only),
`example.com/events` (path prefix), a pasted URL (scheme discarded). The effective list is the union
of the environment list and the project list; every entry is validated the same way.

Per assistant: enable **Browse a website** in Tools Access (opt-in only).

## Enabling it

1. `cd functions/Assistant/browser-worker && ./deploy.sh <projectId>` — builds the image and deploys
   the Cloud Run service with `--no-allow-unauthenticated` and internal ingress. Deliberately **not**
   in `.gitlab-ci.yml`: this repo's documented automatic deploys cover functions, the web build and
   the VM runner, and a fourth production deploy target is a decision, not a side effect of a branch.
2. Set `BROWSER_WORKER_SIGNING_SECRET` on the service.
3. Put the three keys into the env blob and deploy functions.
4. Grant the functions service account `roles/run.invoker` on the service.
5. Allowlist the first hosts, per environment or per project.
6. Enable the tool on one assistant and try it on a page you own.

**Before production:** decide the Gold price. This feature currently charges **nothing** — a browsing
run costs Cloud Run CPU and memory for as long as the session is open and is not metered at all. See
_Open items_.

## Threat model

Assets: the user's Alldone data, their Google Cloud project, other users' data, Alldone's platform
credentials, and the user's standing with the third-party sites the assistant visits.

| threat                                                                        | mitigation                                                                                                                                           | residual                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Prompt injection on a visited page tells the model to buy/send/delete         | the model cannot approve anything; every state-changing action needs a human answer on a signature it cannot forge                                   | a user who approves without reading; injection can still waste budget and produce a misleading answer                                                                                                              |
| Injection tells the model to exfiltrate data by navigating to an attacker URL | allowlist, default deny; every document request and redirect hop re-matched in the worker                                                            | a page may still make **sub-resource** requests anywhere (an image URL can carry data). Sub-resources are not allowlist-restricted because almost no site renders without third-party CDNs                         |
| SSRF into the GCP network / metadata server                                   | private, link-local, CGNAT, loopback, IPv6 ULA and IP literals refused both at allowlist-entry time and at check time; metadata host refused by name | **DNS rebinding**: an allowlisted name that resolves to a private address is not caught, because the check is on the name. Mitigate by giving the worker service restricted egress (VPC connector + egress policy) |
| Credential theft (typing a user's password into a site)                       | credential-shaped input refused outside credential fields; password fields require an approval; no credential store exists to draw from              | a user can still approve a login and type the password into the chat — never ask them to                                                                                                                           |
| Session hijack / persistence                                                  | ephemeral context per run, no storageState in or out, no cookie reuse, idle teardown                                                                 | a site can fingerprint the worker's IP; sessions inside one run share cookies by design                                                                                                                            |
| Leaked worker token                                                           | 2-minute TTL, HMAC-signed, carries its own allowlist and session id, service is not publicly invokable                                               | up to two minutes of browsing on hosts already allowed for that run                                                                                                                                                |
| Malicious page attacks the worker (browser exploit)                           | Chromium sandbox on, non-root container, no host mounts, no credentials in the container, max-instances cap                                          | a Chromium 0-day gets a container with a signed token in memory                                                                                                                                                    |
| Data leaking into the model's context / provider logs                         | credential redaction on all model-facing text; typed text never stored                                                                               | page content the user asked for is by design in the context; a screenshot cannot be redacted and is therefore never handed to the model, only stored and linked                                                    |
| Audit trail tampering                                                         | `browserRuns` / `browserApprovals` have no security rule (Firestore default deny) and are Admin-SDK-only                                             | anyone with Admin SDK access can rewrite records; the SHA-256 on the evidence detects a swapped object, not a rewritten record                                                                                     |
| Cost / abuse                                                                  | per-run step, navigation, screenshot, request, byte and wall-clock budgets; worker session cap and max-instances                                     | no Gold metering yet — see below                                                                                                                                                                                   |
| A project member widens the allowlist                                         | project entries are validated exactly like environment ones; widening only widens what may be READ, since every state change still needs an approval | a member can point the assistant at any public site their project may read                                                                                                                                         |

## Open items before production

- **Gold metering.** Nothing is charged. `mcp_tool_call` is the closest precedent; a per-run or
  per-minute source (`browser_automation`) plus a `GoldTransactionsModal` label and three i18n keys
  is the shape.
- **Approval UI.** The gate is enforced server-side and answered by
  `respondToBrowserApprovalSecondGen`, but no surface renders the pending request yet. Until one
  exists, a sensitive action is simply refused (fail closed) and the assistant explains why. The
  natural home is the VM interaction card (`vmInteraction.js` + its chat UI), which already renders
  approve / deny / allow-for-this-run.
- **Egress restriction** on the worker service (see DNS rebinding above).
- **Deployment**: nothing here has run against a real browser in CI or in a real environment. The
  worker's Playwright code is covered by no automated test at all — jest cannot run Chromium here.

## Tests

```bash
npx jest --config ci/jest.functions.config.js functions/Assistant/browser functions/Assistant/browser-worker
```

`browserAllowlist.test.js` (default deny, SSRF hosts, entry syntax), `browserLimits.test.js`
(clamping, refusal, overshoot), `browserRedaction.test.js` (the model/audit split),
`browserPolicy.test.js` (category detection in three languages, the generic-click bypass, the search
carve-out, signatures), `browserApprovals.test.js` (ownership, single use, denial stickiness,
expiry), `browserSession.test.js` (the whole path with a fake worker: allowlist, limits, audit
evidence, approval gates), `browserToolRegistration.test.js` (the wiring ratchet), and
`../browser-worker/browserWorkerGuard.test.js` (the worker's network guard and its token — the two
rules Functions structurally cannot enforce).

Playwright itself is covered by nothing: it needs a real Chromium, which jest here does not have.
`sharedModules.js` resolves the shared modules from both the repository and the image layout so at
least the guard is testable in place, but the describe step, the snapshot and every action have only
ever been read, never run.
