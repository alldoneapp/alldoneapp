# Gold transactions, analytics and growth scoreboard

Moved out of the root `CLAUDE.md` (2026-11-09); the index there says when to read this file.

## Gold Transactions

- Every gold change (earn, spend, refund, adjustment) must go through `applyGoldChange` / `deductGold` / `refundGold` / `adjustGold` in `functions/Gold/goldHelper.js` so it lands in the user's `goldTransactions` subcollection. Never mutate `users/{uid}.gold` directly — the log is how users see what happened in the Gold history modal.
- When adding a new gold spend or refund, always pass a descriptive `source` (a new machine key, e.g. `meeting_transcription`, `gmail_labeling`) plus as much linking context as you have: `projectId`, `goalId`, `objectId`, `objectType`, `channel`, and an optional human `note`. The sanitized fields are defined in `functions/Gold/goldTransactions.js` — add new fields there if you need more link context.
- Add a human label for every new `source` in `components/SettingsView/Profile/Properties/GoldTransactionsModal.js` (`getTransactionLabel`) and a matching translation key in `i18n/translations/en.json`, `de.json`, and `es.json`. The modal falls back to `Gold transaction` if the source is unknown.
- Prefer storing enough context that the transaction can deep-link back to its source (chat/topic, goal, contact, Gmail message, etc.). The modal's `getTransactionLink` builds the URL from `projectId` + `objectId` + `objectType` / `channel`; extend it when adding a new source type that has a natural destination.

### Nothing a client sends can create Gold

Until October 2026 any signed-in account could mint Gold three ways: write `users/{uid}.gold` itself (the users update rule only protected membership fields), call `refundGoldSecondGen` with any amount (it credited whatever it was sent), or call `deductGoldSecondGen` with a negative amount (the ledger only checked "finite and not zero"). Three rules now hold, and a new gold path must keep them:

- **`gold`, `dailyGold`, `premium` and `stripeCustomerId` on `users/{uid}` are server-owned** (`ownerUpdateKeepsServerFields` in `firestore.rules`; a new account may only start with `getNewDefaultUser`'s defaults). So are the `goldTransactions`, `goldRewardClaims` and `goldChangeClaims` subcollections (owner-readable, never client-writable), because a forged spend could be refunded and a deleted claim re-earned. Never write any of them from the client; a client-triggered grant is a callable that decides the amount itself (the premium signup bonus is `grantPremiumSignupGold`, once per account via an idempotency key, only on the signup check of an account less than a day old).
- **A ledger direction carries its sign** (`deltaMatchesDirection` in `goldTransactions.js`): `spend` negative, `earn` and `refund` positive, only `adjustment` either way.
- **A client refund gives back one of the caller's own charges** (`refundClientSpend`): the refund source must be paired with a spend source in `REFUNDABLE_CLIENT_SPENDS` (`iframe_refund` ↔ `iframe_deduction`, `goal_unlock` ↔ `goal_unlock`), it is matched to the newest spend of that source in the last 24h (and the same `objectId` when given), and the spend's `refundedAmount` caps the total. A new client flow that needs to refund adds its pair there. Server code refunding its own charges keeps using `refundGold`.

**Rewards are granted by the server, never on a request from the browser** (AT-2978,
`functions/Gold/serverGoldRewards.js`). `onUpdateTaskSecondGen` pays when a top-level task moves
forward (open → workflow step → … → done): leaving the open step pays the task's owner, leaving a
workflow step pays that step's reviewer, both only as project members. `onCreateObjectCommentSecondGen`
pays a member's comment in a guide (`parentTemplateId`) on an object the whole project can see, under
the source `guide_comment`. The idempotency key names the step a task LEFT and the person paid
(`task_progress:{taskId}:{stepIndex}:{uid}`), not the transition time, so reopening and completing a
task again pays nothing the second time; a comment is keyed by its id. The amount comes from that key
with the same hash the browser uses for its coin animation (`getRewardGoldAmount`, kept identical in
`utils/backends/firestore.js` and pinned by `serverGoldRewards.test.js`), so the coins shown are the
coins paid; the browser only plays the animation (`showGoldRewardAnimation`). The day the reward lands
on in `statistics/` is the recipient's own local day (`calendarUserDay.js`). `dailyGold` still caps
the total. `earnGoldSecondGen` is kept as a no-op for open tabs of older app versions and pays nothing.

`deductGoldSecondGen` accepts only the spends the app starts itself (`CLIENT_SPEND_SOURCES`), today
only `iframe_deduction` as a whole amount up to 10,000. Any other source is refused, so a client cannot
write ledger entries under server sources and skew `goldStats`. A new client spend adds its source
there. **A guide goal is unlocked by `unlockGuideGoalSecondGen`** (AT-2978,
`functions/Guides/unlockGuideGoal.js`), which charges the 80 Gold (must equal `UNLOCK_GOAL_COST`) and
stores the lock key in one transaction, reading the key and the goal's owner from the stored goal; the
guide creator (administrator or `realTemplateProjectIds`) unlocks for the goal's owner. `firestore.rules`
make `unlockedKeysByGuides` server-owned for owner updates, let a project membership mutation only drop
keys (`unlockedKeysNotAdded`), and let a new account start only without keys. The goal content stays
readable for members in Firestore: the decision was that paying cannot be skipped, not that the content
is hidden. An idempotency claim settles a change only if the ledger wrote it (matching `idempotencyKey`
and `direction`); an empty claim at a predictable key used to count as paid.

**Usage that already happened is charged in full, even below 0** (`settleUsageGold` in
`goldHelper.js`, AT-2978). An assistant answer (`reduceGoldWhenChatWithAI` → `spentGold`) and a
dictation (`processRamble`) are charged after the model and Deepgram have run. `deductGold` is
all-or-nothing, so a cost above the balance used to charge nothing, then the interim fix took only
what was left. Now the full cost is always booked (`allowNegativeBalance` in
`applyGoldChangeInTransaction`, which only that settlement passes), a negative result is logged at
`console.warn` (`[gold] Usage settled into a negative balance`), and every paid entry point refuses to
start while the balance is 0 or less, so a debt blocks the next run until the user tops up (monthly
Gold or a purchase pays it off first). A run is never cut off half-way. Every other spend still needs
the balance to cover it. Client gates must test `gold > 0`, never `gold === 0`, or a negative balance
passes them.

Pinned by `functions/Gold/goldIntegrity.test.js`, `functions/Gold/clientGoldRequests.test.js`, `functions/Gold/serverGoldRewards.test.js`, `functions/Guides/unlockGuideGoal.test.js`, `functions/Assistant/assistantGoldSettlement.test.js`, `functions/Premium/premiumSignupGold.test.js`, `functions/Premium/stripeLinkCode.test.js` and the `server-owned` and `goal lock keys` blocks of `__tests__/Firestore/firestoreRules.emulator.test.js`.

### Gold analytics & rollups (tracking earn/spend over time)

- **GA4 events (consent-gated)**: `goldHelper.js` calls `logGoldAnalytics` → `GAnalytics.logEvent` for every change. `normalizeServerEvent` in `functions/GAnalytics/GAnalytics.js` maps each ledger direction to its **own** GA4 event so they don't pollute each other: `earn_gold`→`earn_virtual_currency`, `spend_gold`→`spend_virtual_currency`, `refund_gold`→`refund_virtual_currency`, `adjust_gold`→`adjust_virtual_currency` (all with `virtual_currency_name: 'gold'`, `value`, `source`). `adjustGold` passes the **signed** delta so admin deductions report a negative `value`. These only fire for users with `analytics.consent === 'granted'`, so GA **undercounts** — use it for trends, not exact totals.
- **Firestore rollups (consent-independent, exact)**: the `aggregateGoldTransactionStats` trigger (`functions/Gold/goldStatsAggregator.js`, registered on `users/{userId}/goldTransactions/{transactionId}` in `index.js`) increments `goldStats/daily/days/{YYYY-MM-DD}` and `goldStats/monthly/months/{YYYY-MM}` (UTC buckets). Each doc holds gross `earn`/`spend`/`refund` + signed `adjust`, per-direction counts, a signed `net`, and `spendBySource`/`earnBySource`/`refundBySource` maps (spend-by-source = feature usage). Idempotent via an `aggregatedAt` stamp on the source ledger doc (guards against at-least-once duplicate trigger delivery; an `update` doesn't re-fire `onDocumentCreated`). `goldStats` is admin-read / server-write only (`firestore.rules`).
- **Deploy steps**: deploy the function + `firebase deploy --only firestore:rules`, then backfill existing history with `node migration/backfillGoldStats.js --firebase-project-id=<project>` (dry run; add `--execute` to apply, `--user-id=<uid>` to scope). The backfill reuses the same per-transaction idempotent path, so it is safe to run with the trigger already live. No Cloud Tasks / IAM grants are needed.
- **A spend total is not interpretable without its billing dimensions (AT-2487).** `spendBySource` says which feature spent Gold; it cannot say why the number moved, because the Gold charged for one unit of the same feature depends on how the run was billed. The VM is the case that forced this: a run on the user's own Claude/Codex subscription or their own API key pays the 20-Gold base reserve and 10 Gold per sandbox minute but **zero** Gold for model tokens (`tokenBillingExempt`), so `vm_execution` — **63%** of August 2026's entire spend, 309,864 of 490,806 Gold — falls both when usage drops and when a user connects a subscription, and the two are indistinguishable. Worse, the ledger carried **nothing joinable to `vmJobs`**, so answering it by hand meant matching on `projectId` + `objectId` + timestamp, which is ambiguous the moment a thread has run more than once. Each source-tracked direction therefore also carries `spendByBilling` / `spendByModel` (and the `refund*` equivalents), keyed `<source>__<value>` — `vm_execution__exempt`, `assistant_usage__gpt-5-2`. `functions/Gold/goldDimensions.js` is the single authority for that key format.

    Four things are load-bearing. **`billingExempt` is a tristate** — `true` (the user's own provider paid for the tokens), `false` (Alldone Gold paid), and **absent** (the question does not apply: a Gmail classification has no exempt variant). Coercing absent to `false` would add a constant to every rollup doc and imply a comparison that does not exist, which is why `sanitizeContext` persists it only for a real boolean and `computeStatsDimensions` emits nothing otherwise. **Keys are source-scoped**, because a bare `opus` bucket would merge VM spend with any future consumer of the same model and could not be reconciled against `spendBySource[source]`. **Model keys are slugged** to `[a-z0-9_-]` (`gpt-5.6-sol` → `gpt-5-6-sol`, `openrouter:deepseek/deepseek-v4-flash-0731` → `openrouter-deepseek-deepseek-v4-flash-0731`): a raw id carries dots, colons and solidi that need backtick-quoted field paths everywhere they are read. The raw value is kept verbatim on the ledger entry, so nothing is lost. And **the model recorded is the one the price was frozen from** (`agentModel`, the requested family/alias), never the concrete `resolvedAgentModel` the CLI reports mid-run — the base reserve is charged before a sandbox exists, so using the resolved id where available would split one run between an `opus` bucket and a `claude-opus-4-5` bucket.

    **Every token-priced charge site declares its model**, not just the VM: `assistant_usage` (via `spentGold`, which also covers pre-configured task topics), Gmail labeling and its follow-up prompt, the email draft-reply and create-task flows, all three routing classifiers, the rambler, and the realtime voice calls (`phone_call` / `whatsapp_call`, plus legacy `browser_call` sessions — token-priced at 100 tokens/Gold, so its `realtimeModel` is now frozen onto the call session at creation rather than read from env config at charge time, which would re-attribute Gold already spent). Flat- and duration-priced sources declare nothing and must keep doing so: `mcp_tool_call`, `iframe_deduction`, `linkedin_enrichment`, `meeting_transcription` and `whatsapp_voice` have no model in their price at all.

    A VM run charges Gold from **five** places (`vmJob.startVmJob`'s base reserve, `vmJobRunner`'s per-minute monitor and settlement top-up, `vmLlmProxy`'s incremental token charges, and the refund paths in `vmJob`/`vmJobRunner`/`vmInteraction`/`vmJobReconciliation`). All of them must stamp the **same** dimensions or one run splits across buckets and stops reconciling, so they read them through the single `buildVmGoldBillingDimensions` in `functions/Assistant/vmGoldDimensions.js` rather than hand-writing a context literal each. Refunds carry them too, so a source's NET Gold cost stays decomposable. `correlationId` is now minted **before** the base reserve is charged so the very first ledger entry of a run is already joinable.

    **Historical data is not backfilled, and cannot be honestly.** Entries written before this shipped carry no `model`/`billingExempt`/`correlationId` at all, and the only way to reconstruct them would be an approximate `vmJobs` match on projectId + objectId + a time window — several runs share a thread, so it would write silent misattribution into buckets that currently just do not exist. Every pre-existing number is therefore **unchanged and still correct**: `spend`, `count` and `spendBySource` are untouched, and a transaction declaring no dimensions writes no dimension fields, so `migration/backfillGoldStats.js` keeps working as-is. Read a dimension map as covering only the period since deploy, and cross-check its per-source total against `spendBySource[source]` for the same window to see how much of it is attributed.

## The growth scoreboard is the growth loop's reward signal, and only code defines it

`growthScoreboardSecondGen` (daily 03:30 UTC, `functions/Growth/`) writes yesterday's funnel to
`growthMetrics/daily/days/{YYYY-MM-DD}`: the Growth project's contacts per status (outreach), GA4
traffic, signups by source, three activation candidates, paying users (started/stopped), revenue
from actual payments, Gold spent with an ESTIMATED upstream cost, and on Mondays the margin per
paying user over 90 days. In production it then rewrites a private artifact "Growth Scoreboard" in
the Alldone Growth project as a new version, so the artifact's history is the scoreboard's history.
`growthMetrics` and `revenueEvents` have no client rule (catch-all deny): no browser and no agent can
read or change the numbers, and an edit to the artifact is replaced by the next run. Every
assumption lives in `growthConfig.js`; the artifact lists them under "What is estimated".

Four things are load-bearing. **Revenue is what was paid, not a price list**: Stripe balance
transactions (real fees, settlement currency; VAT is an estimated share until invoice tax is read)
and the RevenueCat webhook, which now records every priced event in `revenueEvents` because Apple
money never reaches Stripe; Apple subscription revenue therefore only counts from that deploy. A
subscription payment is spread over the month or year it pays for, or a yearly customer would look
unprofitable for nine months. **Signup origin is written once by the browser**:
`utils/growth/signupAttribution.js` keeps the first page load's campaign labels in sessionStorage
(nothing for a visit without a signal; never a click id, a full referrer or a query string) and
writes `users/{uid}/private/signupAttribution` right after the signup batch, outside it so it can
never block provisioning. The owner can write that document, so the server re-sanitises it before it
becomes a map key. **No person leaves the run**: the day document holds counts, sums and
percentiles only; the premium user ids the next run needs to count who started and stopped live in
the server-only `growthMetrics/state`. The administrator and `EXCLUDED_USER_IDS` are left out of
margins. **GA4 needs no configuration in code**: the run lists the properties its own service
account (the Firebase Admin SDK account) may read, so granting that account Viewer on a property is
the setup; until then the section says what is missing. GA only sees consenting visitors, so the
run compares the `sign_up` events GA saw with the real signups from Firebase Auth (`visibleShare`).

**Paying users come from Stripe, not from `users/{uid}.premium`.** That flag is only refreshed when
the premium checker runs for a user (login, checkout) and is stale for most subscribers: the first
production run (2026-11-08) counted 2 flagged users against about 26 active subscriptions. The run
lists Stripe's `active` subscriptions (and counts `trialing`/`past_due`), matches each customer to an
account by `stripeCustomerId` or, failing that, by its VERIFIED email (`findUserIdByVerifiedEmail`),
and reads Apple subscribers from the premium status RevenueCat sets (`premium.source == 'apple_iap'`).
"Logged in" counts `lastLogin`, which moves only on a real login, so it understates daily use.

**Never hand a `google-auth-library` client to a `googleapis` module in Functions.** `googleapis`
bundles google-auth-library 10 while `functions/` uses 9; googleapis-common then reads the v9
client's headers in the v10 shape and sends the request with NO credentials, which Google answers
with "Login Required" — it looks like a permission problem and is not one. `growthTraffic.js` calls
the GA REST endpoints with a token from our own `GoogleAuth` instead.

Costs are bounded: Firebase Auth's user list (API pages, no Firestore reads), three days of
signups, count() queries, one goldStats rollup, the day's Stripe transactions; only the Monday
margin reads every paying user's Gold ledger. `run` on each document reports what was read. Pinned
by `functions/Growth/growthModels.test.js`, `growthScoreboard.test.js` and
`utils/growth/signupAttribution.test.js`.
