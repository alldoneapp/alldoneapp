'use strict'

// The billing dimensions every VM Gold movement carries (AT-2487).
//
// A VM run charges Gold from five separate places — the up-front base reserve
// (`vmJob.startVmJob`), the per-minute compute monitor and the final settlement top-up
// (`vmJobRunner`), the proxy's incremental token charges (`vmLlmProxy`), and the refund
// paths (`vmJob`, `vmJobRunner`, `vmInteraction`, `vmJobReconciliation`). All five must
// stamp the SAME dimensions or a single run splits across buckets in `goldStats` and the
// rollup stops reconciling against `spendBySource.vm_execution`. Hence one reader,
// applied everywhere, rather than five hand-written context literals.
//
// It reads the fields as persisted on a `pendingWebhooks` or `vmJobs` document, which
// both carry `agentModel`, `tokenBillingExempt` and `correlationId`, so a call site only
// has to hand over whichever of the two it already holds.

// `agentModel` is the model as REQUESTED (`opus`, `gpt-5.6-sol`, `openrouter:deepseek/...`)
// and is deliberately preferred over the concrete `resolvedAgentModel` the CLI reports
// mid-run. The base reserve is charged before a sandbox exists, so the resolved id is not
// yet known there; using it where available would split one run's spend between an `opus`
// bucket and a `claude-opus-4-5` bucket. The requested value is stable for the whole run
// and is also the value the price was frozen from (`tokensPerGold`).
function buildVmGoldBillingDimensions(job = {}) {
    const dimensions = {}
    if (!job || typeof job !== 'object') return dimensions

    const model = typeof job.agentModel === 'string' ? job.agentModel.trim() : ''
    if (model) dimensions.model = model

    // Tristate by contract: only a real boolean is forwarded. A job document written
    // before this field existed leaves the dimension undeclared rather than claiming
    // "Gold-billed", which would be an assertion the document does not actually make.
    if (typeof job.tokenBillingExempt === 'boolean') dimensions.billingExempt = job.tokenBillingExempt

    const correlationId = typeof job.correlationId === 'string' ? job.correlationId.trim() : ''
    if (correlationId) dimensions.correlationId = correlationId

    return dimensions
}

module.exports = { buildVmGoldBillingDimensions }
