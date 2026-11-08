'use strict'

// Every assumption the growth scoreboard makes, in one place.
//
// The scoreboard is the reward signal of the growth loop (functions/Growth/growthScoreboard.js).
// Agents read it and are judged by it, so none of this is data an agent can change: it is code,
// reviewed like code. Anything that is an ESTIMATE says so and is listed again in the "What is
// estimated" section of the scoreboard artifact, so a reader can tell measured from assumed.

// Everything is reported in euros, the currency Stripe settles in. Upstream model and sandbox
// prices are quoted in US dollars and converted with this rate. ESTIMATE: update it when the
// exchange rate moves more than a few percent.
const REPORTING_CURRENCY = 'EUR'
const FX_TO_EUR = Object.freeze({ EUR: 1, USD: 0.87 })

// Apple: RevenueCat events normally carry `tax_percentage` and `commission_percentage`, and the
// real proceeds are price x (1 - tax) x (1 - commission). These defaults only apply to an event
// without them. ESTIMATE: Small Business Program commission and an average EU VAT share.
const APPLE_DEFAULT_COMMISSION_SHARE = 0.15
const APPLE_DEFAULT_TAX_SHARE = 0.16

// A VM run pays for two things: the E2B sandbox and the Cloud Run job that supervises it
// (functions/Assistant/vmJob.js charges VM_GOLD_PER_MINUTE Gold per started minute for both).
// ESTIMATE, from the list prices: E2B 2 vCPU + 1 GiB at $0.000014/vCPU-s and $0.0000045/GiB-s,
// Cloud Run 1 vCPU + 1 GiB at $0.000018/vCPU-s and $0.000002/GiB-s.
const E2B_SANDBOX_USD_PER_MINUTE = 0.00195
const VM_RUNNER_USD_PER_MINUTE = 0.0012
// Kept equal to vmJob.js's VM_GOLD_PER_MINUTE by growthCostModel.test.js.
const VM_GOLD_PER_MINUTE = 10

// The in-app assistant bills tokens counted from the text it sends and receives; upstream, the
// provider bills fresh input, cached input and output at different prices. ESTIMATE of that mix
// for chat (more output and fewer cache hits than a VM agent's 85% cache reads).
const ASSISTANT_TOKEN_MIX = Object.freeze({ input: 0.35, cachedInput: 0.55, output: 0.1 })

// Gold spent on things with no upstream cost: a game item or unlocking a goal costs nothing to
// serve, so it adds no cost to a margin.
const ZERO_COST_GOLD_SOURCES = Object.freeze(['rage_mode_item', 'goal_unlock'])

// Sources that run a VM: their Gold pays for the sandbox and, unless the user's own subscription
// or key paid, for model tokens.
const VM_GOLD_SOURCES = Object.freeze(['vm_execution', 'vm_job'])

// Margin: revenue after fees minus the estimated upstream cost of the Gold a paying user spent,
// over a trailing window. Computed once a week (it reads every paying user's Gold ledger).
const MARGIN_WINDOW_DAYS = 90
const MARGIN_WEEKDAY_UTC = 1 // Monday

// Accounts that never count as customers in margins: the team's own accounts. The administrator
// in roles/administrator is excluded automatically on top of these.
const EXCLUDED_USER_IDS = Object.freeze([])

// Activation candidates, all recorded until one is chosen (decision 08.11.2026):
// (a) created a task and got an assistant reply within 7 days,
// (b) connected WhatsApp, Gmail or a calendar within 7 days,
// (c) spent Gold on assistant work on 3 different days within 14 days.
const ACTIVATION_SHORT_WINDOW_DAYS = 7
const ACTIVATION_LONG_WINDOW_DAYS = 14
const ACTIVATION_GOLD_DAYS = 3
// Tasks created this soon after signup are the ones signup creates itself.
const SIGNUP_SETUP_GRACE_MS = 2 * 60 * 1000

// Labels in maps: at most this many keys per breakdown, the rest is summed under "other".
const MAX_BREAKDOWN_KEYS = 30

// Where the daily scoreboard artifact is written. Only production has one: the Alldone Growth
// project, owned by the founder's account. Staging computes the metrics without publishing.
const SCOREBOARD_ARTIFACT_TARGETS = Object.freeze({
    production: Object.freeze({
        projectId: 'jKqTTedFM8JyHZpVnsDR',
        ownerUserId: 'lejVqrT6FBcMRRCxnBbBhQwPgSg1',
    }),
})
const SCOREBOARD_HISTORY_DAYS = 30

module.exports = {
    REPORTING_CURRENCY,
    FX_TO_EUR,
    APPLE_DEFAULT_COMMISSION_SHARE,
    APPLE_DEFAULT_TAX_SHARE,
    E2B_SANDBOX_USD_PER_MINUTE,
    VM_RUNNER_USD_PER_MINUTE,
    VM_GOLD_PER_MINUTE,
    ASSISTANT_TOKEN_MIX,
    ZERO_COST_GOLD_SOURCES,
    VM_GOLD_SOURCES,
    MARGIN_WINDOW_DAYS,
    MARGIN_WEEKDAY_UTC,
    EXCLUDED_USER_IDS,
    ACTIVATION_SHORT_WINDOW_DAYS,
    ACTIVATION_LONG_WINDOW_DAYS,
    ACTIVATION_GOLD_DAYS,
    SIGNUP_SETUP_GRACE_MS,
    MAX_BREAKDOWN_KEYS,
    SCOREBOARD_ARTIFACT_TARGETS,
    SCOREBOARD_HISTORY_DAYS,
}
