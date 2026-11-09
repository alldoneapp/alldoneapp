# Assistant browsing (browser_* tools)

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## Browsing (`browser_*`) — the classification runs on the PAGE, not on the tool call

`fetch_url` reads a page's HTML; the six `browser_*` tools OPEN one in a real browser
(`functions/Assistant/browser/` for the policy half, `functions/Assistant/browser-worker/` for the
Playwright half, deployed as its own Cloud Run service). They exist for the questions a plain read
cannot answer — a client-rendered event page, a date picker, "are there still tickets" — and they are
one Tools Access key (`browser_automation`, opt-in only) that `getToolSchemas` fans out into six tool
names. **Workers are configured in staging and production (2026-10-07)**. Each environment has
its own IAM-private `browser-worker` Cloud Run service and matching `BROWSER_WORKER_URL` /
`BROWSER_WORKER_SIGNING_SECRET` in its GitLab Functions environment. The Firebase Admin SDK service
account has service-scoped `roles/run.invoker`. Browsing still requires the assistant toggle and a
project website policy: `selected` needs an allowlist, while `all_public` allows public websites.
The shared assistant workspace watches this same browser through `annaBrowserWorkspaceSecondGen`;
it refreshes screenshots every five seconds and supports user takeover and explicit hand-back.
Interactive login is owned by `AnnaShell` through `AnnaBrowserTakeoverContext` and rendered in the
browser pane. The approval card retains only a reopen shortcut. Keep the login controller mounted
across chat navigation and pane changes; pause the ordinary viewer and never let a chat send release
the login session. Outside this shell the approval card still supports inline takeover.
See `docs/anna-workspace.md` for deployment and verification.

****Two access modes, and `all_public` skips exactly ONE check.** `selected` (the default) needs an
allowlist match; `all_public` is opt-in per project and does not consult the allowlist at all.
Everything before that last question is unconditional in both: http(s) only, no credentials in the
URL, no IP literals, no loopback / private / link-local / CGNAT / IPv6-ULA, no cloud metadata hosts,
no single-label or `.internal` / `.local` names, and a denylist that is checked BEFORE the mode so it
means the same thing in both. An unrecognised stored value reads as `selected` — the fail-closed
direction, implemented identically in `normalizeAccessMode` (server) and `normalizeBrowserAccessMode`
(editor) and pinned by `browserAllowlistParity.test.js`. The mode is **not a client claim**: it is
read from the project document, folded into one policy object, and travels to the worker inside the
HMAC-signed token, so editing it breaks the signature.

**A redirect hop does not pass through the route handler, and that was a real gap.** Playwright's
`route.continue()` makes Chromium follow a 3xx internally and interception is not re-run for the new
request (verified with a probe against 1.49) — so until AT-2518's second pass, only the LANDING url
was checked, and a chain that went through an internal host and back out to a permitted one would
have completed with the internal page fetched and rendered. `ensureNetworkGuard` now also listens on
the `request` event, which does fire per hop, records a hop that is not permitted, and the action
functions fail the whole navigation on it. What it still cannot do is stop that hop's request from
being issued — no Playwright API can — which is why restricted egress on the worker is a required
deployment step rather than a nice-to-have. A failed navigation now also parks the page on
`about:blank`, because Chromium's error page commits asynchronously and otherwise interrupts the
NEXT navigation.

The bypass this design exists to close is that `click` and `type` can perform a purchase, a login
or a deletion without naming any of them.** A gate reading the model's own description of what it is
about to do is therefore worthless — the model would only have to call a Buy button "the green
button". So `browserSession.js` enforces the ordering **observe → classify → approve → act**: for a
click or a type the worker is first asked to `describe` the element (resolve it in the live DOM,
report role, accessible name, input type, the enclosing form's method and action, and the labels of
that form's submit controls) **without touching it**, and `browserPolicy.js` classifies that. Nothing
model-authored is an input to the decision, and an element that cannot be resolved is a refusal
rather than an unclassified click. Categories that always pause: login, file upload, booking,
payment, submit/publish, delete, external message — matched in en/de/es, and an **unrecognised form
submission is `submit_publish`, i.e. it pauses too**. The single carve-out is a GET form with
search-shaped fields (`search_submit`), because without it the feature cannot answer the question it
was built for; it never applies when a sensitive category also matched.

**An approval answers ONE question.** A grant is keyed on a signature over
(action, category, host, element shape), is created only by `respondToBrowserApprovalSecondGen`, only
by the user the request was raised for, defaults to single use, expires in 15 minutes and never
outlives the run — so "yes, book that table" can never be replayed as "yes, delete the account". A
denial sticks for the rest of the run, because otherwise the model re-asks in a loop until the user
clicks the wrong button. `BrowserApprovalCard` renders the pending request under the assistant
comment that asked for it — the same card and the same three answers as `VmInteractionCard`, keyed to
that comment by `assistantCommentId` — and reads it over a live listener on `browserApprovals`, which
is readable only by the user it was raised for and writable by nobody. **"Allow for this run" is a
POLICY decision** (`RUN_SCOPED_APPROVAL_CATEGORIES`: yes for `submit_publish` and `booking`, no for
login, payment, delete, upload and external message), and `respondToBrowserApproval` downgrades a
run-scoped answer to single use for the rest whatever the client asked — a hidden button is a hint,
not a control. The assistant's turn has already ended by the time it asks (unlike a VM run, which
parks and is still alive), so the card says to ask it to continue rather than pretending to resume.

**The billed unit is one EXECUTED step at 1 Gold**, the same unit and price as `mcp_tool_call`.
A step the policy refused, a step that paused for an approval, a step the worker failed and a step
refused by the budget are all **free** — billing a user for the protection working is how a
protection gets switched off, and a paused action is attempted again after the answer, so charging
both attempts would double-charge one decision. Idempotency is structural: the step id is minted once
inside the transaction that hands the step out and is the ledger's idempotency key
(`deductGold` now forwards `context.idempotencyKey`, exactly as `refundGold` already did). The
balance is checked BEFORE the browser is touched — acting first and finding an empty balance
afterwards performs something on a third-party site that Alldone then cannot bill — and that check
fails open, since the charge itself still uses `requireSufficientBalance`.

Three more things worth knowing. The **budget is charged in the same Firestore transaction that hands
out the step** and lives on the run document — a budget held in a Functions instance means "per
instance", and two tool calls racing in one thread would each see the last navigation as free. The
worker token **carries the allowlist and the limits** (`browserWorkerClient.js`), so the worker
enforces redirects and page-initiated navigations at the network layer — where Functions cannot see
them — without ever deciding what the allowlist is. And redaction is **two-sided on purpose**:
credentials are stripped from what the model sees, credentials _and_ PII from what the audit trail
keeps, and typed text is never persisted at all (`describeTypedValue` keeps a length and a shape).
Redacting page content on the way to the model would delete the answer the user asked for.

**The allowlist has an editor, reached from the tool row that needs it, and it is where the mode is
chosen** (off / only selected websites / all public websites, in that order of risk, with a warning
under the third that says both what changes and what does not). Ticking "Browse a website"
and finding that nothing works — because the list is empty and default deny — is the dead end the
row exists to prevent, so the Tools Access modal shows `Allowed websites (N)` under the checked box
and hands over to `BrowserAllowlistModal` **sequentially** (close, then open: a nested
react-tiny-popover treats a tap in the child as an outside click of the parent). The list is stored
per PROJECT (`projects/{id}.browserAutomation`) because two assistants in one project must not
disagree about which sites may be opened. Its validator exists twice — `utils/browserAllowlistInput.js`
for the editor, `browserAllowlist.js` for the policy — because Functions code cannot enter the web
bundle; the contract is one-directional and ratcheted by `browserAllowlistParity.test.js`: anything
the editor accepts, the server accepts and normalizes identically, and anything the server rejects
the editor rejects (the editor may be stricter, e.g. about `ftp://`).

Pinned by the ten suites in `functions/Assistant/browser/`, the two web suites
(`BrowserApprovalCard.test.js`, `BrowserAllowlistModal.test.js`) and `browser-tests/at2518` — the
only place Playwright actually runs. Configuration, enabling steps, the threat model, the Gold model
and the open items (deployment, worker egress, price review) are in
`functions/Assistant/browser/README.md`.
