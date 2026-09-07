# Browser tools (`browser_*`) — developer guide and threat model

The assistant can open a page in a real browser, read it, interact with it and screenshot it. This
directory is the Cloud Functions half: configuration, policy, approvals, limits, evidence and the
audit trail. The browser itself runs in `../browser-worker`, a separate Cloud Run service.

**Status: not enabled anywhere.** Nothing is deployed, no environment carries the configuration, and
with no configuration every call is refused with a message naming what is missing. Switching it on
is a deliberate operational act — see _Enabling it_ below. The feature itself is complete: the
allowlist has an editor, sensitive actions have an approval card, every executed step is billed, and
the whole stack has been driven against a real Chromium (`browser-tests/at2518`).

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

| control                             | where                                     | behaviour                                                                                                                                                                           |
| ----------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access mode, **default `selected`** | `browserAllowlist.js`, `browserConfig.js` | `selected` needs an allowlist match; `all_public` is opt-in and skips ONLY that last check. Anything unrecognised reads as `selected`                                               |
| Domain allowlist, **default deny**  | `browserAllowlist.js`, `browserConfig.js` | empty list ⇒ nothing is reachable in `selected`. No IPs, no private hosts, no bare `*`, no single-label hosts                                                                       |
| Denylist                            | `browserAllowlist.js`                     | checked BEFORE the mode, so it means the same in both: never this host                                                                                                              |
| Redirect containment                | worker `browserActions.js`                | every document request AND every redirect hop is checked; a hop that is not permitted fails the whole navigation, including a chain that goes through an internal host and back out |
| Run limits                          | `browserLimits.js`                        | steps, navigations, screenshots, requests, bytes, wall clock — charged in the step transaction, persisted on the run                                                                |
| In-page limits                      | worker                                    | request/byte caps, redirect cap, per-step timeout, idle teardown                                                                                                                    |
| Ephemeral context                   | worker `sessionStore.js`                  | one context per run, no `storageState` in or out, downloads refused, dialogs dismissed, popups closed                                                                               |
| No credentials anywhere             | policy + worker                           | a credential-shaped string is never typed outside a credential field; nothing is persisted between runs                                                                             |
| Approval gates                      | `browserPolicy.js`, `browserApprovals.js` | login, upload, booking, payment, submit/publish, delete, external message — refused until the requesting user approves                                                              |
| Bypass prevention                   | `browserSession.js`                       | describe-then-classify; an unresolvable element is a refusal, not an unclassified click                                                                                             |
| Audit trail                         | `browserAudit.js`                         | one run doc + one step doc per tool call: decision, category, evidence for the decision, approval id, usage, timings                                                                |
| Evidence                            | `browserEvidence.js`                      | screenshot + DOM/AX snapshot in Storage with SHA-256, referenced from the step                                                                                                      |
| Redaction                           | `browserRedaction.js`                     | credentials out of model-facing text; credentials **and** PII out of records; typed text never stored                                                                               |
| Worker authentication               | `browserWorkerClient.js`                  | per-call HMAC token, 2-minute TTL, carrying the MODE, allowlist, denylist and limits so the worker cannot widen them                                                                |

### Access modes

Three settings, in order of risk, chosen in the assistant's Tools Access → **Allowed websites**:

| mode                       | stored as                          | meaning                                         |
| -------------------------- | ---------------------------------- | ----------------------------------------------- |
| Browsing is off            | `enabled: false`                   | no page can be opened in this project           |
| **Only selected websites** | `accessMode: 'selected'` (default) | only hosts on the allowlist                     |
| All public websites        | `accessMode: 'all_public'`         | any public host that survives the safety checks |

`all_public` is opt-in, carries a warning in the editor, and changes **exactly one thing**: whether
the allowlist is consulted. Everything else is unconditional and not configurable —

- http(s) only (`file:`, `data:`, `javascript:`, `ftp:` and the rest are refused),
- no credentials in the URL,
- no IP literals at all, public or private,
- no loopback, private, link-local, CGNAT or IPv6-ULA ranges,
- no cloud metadata endpoints (`169.254.169.254`, `metadata.google.internal`, bare `metadata`),
- no single-label hosts, `.internal`, `.local`, `.localhost` or `.home.arpa`,
- **and the same rules on every redirect hop**, which is the case `all_public` makes matter.

An unknown value in the stored field reads as `selected`. That is not a preference, it is the
fail-closed direction: a corrupt document, a typo, an older client or a future mode name must land on
"only what somebody listed", never on "the whole internet". Both `normalizeAccessMode` (server) and
`normalizeBrowserAccessMode` (editor) implement it, and `browserAllowlistParity.test.js` pins that
they agree.

The mode is **not a client claim**. It is read from the project document by Cloud Functions, folded
into the browsing policy, and travels to the worker inside the HMAC-signed token — so nothing that
merely talks to the worker can assert "all public websites", and editing the mode inside a token
breaks its signature.

### The denylist

`browserAutomation.deniedDomains` (plus the environment-wide `BROWSER_DENIED_DOMAINS`, unioned,
because union is the safe direction for a deny rule). Same entry syntax and same validation as the
allowlist; the editor's second list writes it.

It is checked **before** the mode, so it means the same thing in both: "not this host, whatever else
is configured". Checking it after the mode would make it dead weight in `selected` and would invite
the reading that it is an `all_public`-only feature.

### Categories that always pause

`login`, `file_upload`, `booking`, `payment`, `submit_publish`, `delete`, `external_message`.
Detected in English, German and Spanish from the observed element, its form and the URL path.
An unrecognised form submission is `submit_publish` — i.e. it pauses too.

**One carve-out:** a GET form whose fields are search-shaped is `search_submit` and runs without an
approval. It changes nothing on the far side, and without it the feature cannot answer the question
it exists for. It never applies when a sensitive category also matched, and a project can switch it
off with `browserAutomation.allowSearchSubmit: false`.

### Gold

**The billed unit is one EXECUTED browser step** — one `browser_*` tool call that reached the browser
and did something — at **1 Gold**, the same unit and price as `mcp_tool_call`, which is the closest
precedent: a single, bounded, externally-effective tool call whose cost is dominated by holding
infrastructure open rather than by tokens. A typical "check whether that event still has tickets" run
is 4–8 steps, i.e. 4–8 Gold, which lands in the same order as one assistant answer.

Not billed, and each omission matters:

| not charged                                                               | why                                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| a step the policy refused                                                 | billing the user for the protection working is how people switch it off        |
| a step that paused for an approval                                        | nothing was delivered, and the same action is attempted again after the answer |
| a step the worker failed (timeout, page down, redirect off the allowlist) | nothing usable came back                                                       |
| a step refused by the run budget                                          | it never reached the browser                                                   |

Double-charging is prevented structurally: the step id is minted once inside the transaction that
hands the step out, and it is the ledger's **idempotency key** (`browser_step:<stepId>`), so a
Functions retry or an at-least-once redelivery lands on the existing claim. `deductGold` forwards
`context.idempotencyKey` exactly as `refundGold` already did.

Affordability is checked **before** the browser is touched — acting first and finding an empty
balance afterwards would perform something on a third-party site that Alldone then cannot bill. That
check fails OPEN on an unreadable balance (the charge itself still uses `requireSufficientBalance`,
so a genuinely empty balance cannot go negative). A charge that fails after a successful action is
recorded on the step and logged; it never turns a successful page read into a tool error.

`functions/Assistant/browser/browserGold.js` is the only place any of this is decided.

### What an approval is

A grant against the policy **signature** — `(action, category, host, element shape)` — created only
by `respondToBrowserApprovalSecondGen`, only by the user the request was raised for, defaulting to
single use, expiring after 15 minutes and never outliving the run. Approving "book that table" can
never be replayed as "delete the account". A denial sticks for the rest of the run, so the model
cannot loop on the dialog.

### The approval card

`components/ChatsView/ChatDV/EditorView/BrowserApprovalCard.js` renders the pending request under the
assistant comment that asked for it, with **Allow once**, **Allow for this run** and **Deny** — the
same card, the same three answers and the same wording as `VmInteractionCard`, because it is the same
question, and a differently-shaped answer to it is how a user learns that approving in one surface
does not mean what it means in the other.

Which comment it hangs off is decided by `assistantCommentId`, stamped on the request from the
runtime context (`assistantHelper` puts the assistant's own answer comment id there). A thread can
hold more than one browsing run, and a card under the wrong comment is a request the user cannot
place in the conversation.

**"Allow for this run" is a policy decision, not a UI one.** `RUN_SCOPED_APPROVAL_CATEGORIES` in
`browserPolicy.js` allows it for `submit_publish` and `booking` — several presses of the same shaped
control in one flow, where answering each identical press is what trains people to stop reading the
dialog — and refuses it for `login`, `payment`, `delete`, `file_upload` and `external_message`, each
of which is its own irreversible act. The card hides the button, and `respondToBrowserApproval`
**downgrades a run-scoped answer to single-use** for those categories regardless of what the client
asked for: a hidden button is a hint, not a control.

The card reads the request over a live Firestore listener — `browserApprovals` is readable **only**
by the user the request was raised for and writable by nobody (`firestore.rules`) — and answers
through `respondToBrowserApprovalSecondGen`. The assistant's turn has already ended by the time it
asks, so the confirmation says to ask it to continue rather than pretending it resumes by itself; the
grant is waiting and the next attempt at the same action goes through. That pause → approve → resume
path runs end to end against real Chromium in `browser-tests/at2518`.

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
  accessMode: 'selected',               // or 'all_public'; anything else reads as 'selected'
  allowedDomains: ['eventim.de', '*.kulturhaus.example', 'shop.example/events'],
  deniedDomains: ['ads.example', '*.tracker.example'],
  allowSearchSubmit: true,
  limits: { maxNavigations: 5 },        // may only NARROW the defaults
}
```

Allowlist syntax: `example.com` (apex + subdomains), `*.example.com` (subdomains only),
`example.com/events` (path prefix), a pasted URL (scheme discarded). The effective list is the union
of the environment list and the project list; every entry is validated the same way.

Per assistant: enable **Browse a website** in Tools Access (opt-in only). The same row then shows
**Allowed websites (N)**, which opens the editor for the list above — ticking the box and finding
that nothing works, because the list is empty and default deny, is exactly the dead end that row
exists to prevent. The editor validates as you type (`utils/browserAllowlistInput.js`) and names the
specific problem; it never accepts an entry the server would silently drop, which is pinned by
`browserAllowlistParity.test.js`.

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

**Before production:** nothing in the code is missing, but two operational decisions are: the first
allowlist (which sites the assistant may open at all) and whether 1 Gold per step is the price you
want (see _Gold_).

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

### One redirect detail worth knowing

Playwright's `route.continue()` makes Chromium follow a 3xx **internally**, and interception is not
re-run for the new request — verified against Playwright 1.49 with a probe, and it is why the route
handler alone was never enough. The `request` event _is_ fired for every hop, so `ensureNetworkGuard`
listens there, records a hop that is not permitted, and the action functions fail the whole
navigation on it (`reason: 'redirect_off_allowlist'`).

Two consequences, and the second is the honest limitation:

- A chain that redirects **through** an internal host and back out to a permitted one now fails.
  The landing-URL check alone would have passed it, which is the SSRF shape that matters most.
- The hop's request is **issued** before it is judged; nothing from it is rendered, returned to the
  model, stored as evidence or written to the audit beyond the refusal, but a GET did leave the
  container. No Playwright API can abort a hop the browser follows internally. Restricted egress on
  the worker service is the control that closes this, and the deploy script prints it as a required
  step.

## Open items before production

- **Deployment.** Nothing here has run in a real environment: no worker is deployed, no environment
  carries the configuration, and the price has not been agreed. The integration test proves the code
  works against a real browser on a developer machine; it proves nothing about Cloud Run.
- **Egress restriction** on the worker service (see DNS rebinding above).
- **Gold price review.** 1 Gold per executed step is the agreed product decision (2026-09-07), pinned
  to `mcp_tool_call` rather than to observed Cloud Run cost. Worth revisiting once real runs exist —
  a typical "check this site" run is 4–8 steps.
- **Resume is manual.** After approving, the user asks the assistant to continue. Automatically
  resuming the turn would mean parking a chat run the way a VM run parks, which is a change to the
  streaming tool loop rather than to this feature.

## Tests

```bash
npx jest --config ci/jest.functions.config.js functions/Assistant/browser functions/Assistant/browser-worker
```

`browserAllowlist.test.js` (default deny, SSRF hosts, entry syntax), `browserLimits.test.js`
(clamping, refusal, overshoot), `browserRedaction.test.js` (the model/audit split),
`browserPolicy.test.js` (category detection in three languages, the generic-click bypass, the search
carve-out, signatures, run-scope categories), `browserApprovals.test.js` (ownership, single use,
denial stickiness, expiry, run-scope downgrade), `browserGold.test.js` (the unit, idempotency, the
pre-flight balance check, failure behaviour), `browserSession.test.js` (the whole path with a fake
worker: allowlist, limits, audit evidence, approval gates, billing), `browserAllowlistParity.test.js`
(the editor and the policy agree), `browserToolRegistration.test.js` (the wiring ratchet), and
`../browser-worker/browserWorkerGuard.test.js` (the worker's network guard and its token — the two
rules Functions structurally cannot enforce).

Web side: `components/ChatsView/ChatDV/EditorView/BrowserApprovalCard.test.js` and
`components/UIComponents/FloatModals/BrowserAllowlistModal/BrowserAllowlistModal.test.js`.

### The real browser

```bash
npx playwright install chromium      # into PLAYWRIGHT_HOME, default /home/user/repro
node browser-tests/at2518/run.js
```

The only place Playwright is actually executed. It starts the REAL worker process against a REAL
Chromium and drives the REAL `executeBrowserTool` against a fixture site served under a
public-looking name (`--host-resolver-rules`, so the allowlist is not weakened for the test), and
checks navigate, inspect, type+submit, wait, screenshot, the approval pause, the approve→resume
path, a denial sticking, an off-allowlist host, a redirect off the allowlist, the audit trail and
the Gold charges. 34 checks; exit code 0 = pass.
