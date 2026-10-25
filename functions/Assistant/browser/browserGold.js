'use strict'

// Gold for browsing.
//
// **The billed unit is one EXECUTED browser step** — one `browser_*` tool call that actually
// reached the browser and did something — at `BROWSER_STEP_GOLD` (1) Gold, the same unit and the
// same price as `mcp_tool_call`, which is the closest existing precedent: a single, bounded,
// externally-effective tool call whose cost is dominated by holding infrastructure open rather than
// by tokens.
//
// What is deliberately NOT billed, and why each one matters:
//
// - A step the POLICY refused (off-allowlist, private host, a credential typed into a search box).
//   Charging for a refusal bills the user for the protection working.
// - A step that paused for an approval. The user has not received anything yet, and the same action
//   will be attempted again after they answer — billing both attempts would double-charge one
//   decision.
// - A step the WORKER failed (page down, timeout, redirect off the allowlist). Nothing usable came
//   back. This is the same call the user would have to repeat.
// - A step refused by the run budget. It never reached the browser.
//
// So the ledger reads as "N pages actually opened, inspected, clicked or captured", which is the
// only unit a user can reconcile against what the assistant told them it did.
//
// Double-charging is prevented structurally rather than by care. The step id is minted once, inside
// the transaction that hands the step out (`browserAudit.beginBrowserStep`), so it is unique per
// tool call by construction; it is passed to `applyGoldChange` as the idempotency key, so a Cloud
// Functions retry, an at-least-once redelivery or an overlapping invocation that somehow reached
// the same step lands on the existing claim and charges nothing. The step document additionally
// records the charge, which is what makes an audit reconcilable without joining the ledger.

const BROWSER_GOLD_SOURCE = 'browser_automation'

// One executed step. Kept equal to MCP_TOOL_CALL_GOLD on purpose: the two are the same kind of
// thing from the user's side, and a browsing run is a handful of steps, so the run-level price
// lands in the same order as one assistant answer.
const BROWSER_STEP_GOLD = 1

function buildIdempotencyKey(stepId) {
    return `browser_step:${stepId}`
}

/**
 * Can this user afford the step that is about to run?
 *
 * Asked BEFORE the browser is touched, because the alternative — act first, discover the empty
 * balance afterwards — performs an action on a third-party site that Alldone then cannot bill.
 * The read is one document and only happens for a step that is otherwise going to run.
 *
 * Fails OPEN: an unreadable balance must not take browsing down for everybody. The charge itself
 * still uses `requireSufficientBalance`, so an actually-empty balance cannot go negative.
 */
async function hasGoldForBrowserStep(db, userId, price = BROWSER_STEP_GOLD) {
    if (!userId || price <= 0) return { ok: true, gold: null }
    try {
        const snapshot = await db.doc(`users/${userId}`).get()
        if (!snapshot.exists) return { ok: true, gold: null }
        const gold = Number(snapshot.data()?.gold)
        if (!Number.isFinite(gold)) return { ok: true, gold: null }
        return { ok: gold >= price, gold }
    } catch (error) {
        console.warn('🌐 BROWSER GOLD: could not read the balance, letting the step run', {
            userId,
            error: error.message,
        })
        return { ok: true, gold: null }
    }
}

/**
 * Charge one executed step. Never throws: the browsing has already happened, and turning a
 * successful page read into a tool error because the ledger write failed would be the worst of both
 * outcomes. A failure is recorded on the step instead, so it is visible rather than lost.
 */
async function chargeGoldForBrowserStep({
    db,
    userId,
    runId,
    stepId,
    projectId,
    objectId,
    objectType,
    toolName,
    hostname,
    price = BROWSER_STEP_GOLD,
    deductGoldImpl = null,
}) {
    if (!userId || !stepId || price <= 0) return { charged: false, skipped: true }

    const deduct = deductGoldImpl || require('../../Gold/goldHelper').deductGold
    try {
        const result = await deduct(userId, price, {
            source: BROWSER_GOLD_SOURCE,
            channel: 'assistant',
            projectId: projectId || '',
            objectId: objectId || '',
            objectType: objectType || 'tasks',
            // The run id is what joins a ledger entry back to `browserRuns` — without it a spend of
            // 7 Gold on one thread cannot be told apart from seven unrelated ones.
            correlationId: runId || '',
            note: `${toolName || 'browser'}${hostname ? ` · ${hostname}` : ''}`,
            idempotencyKey: buildIdempotencyKey(stepId),
        })

        const charged = result?.success === true && result?.alreadyProcessed !== true
        if (db && runId && stepId) {
            await db
                .doc(`browserRuns/${runId}/steps/${stepId}`)
                .set(
                    {
                        goldCharged: result?.success === true,
                        goldAmount: charged ? price : 0,
                        goldAlreadyProcessed: result?.alreadyProcessed === true,
                        goldError: result?.success === true ? null : result?.message || 'gold_charge_failed',
                    },
                    { merge: true }
                )
                .catch(error => {
                    console.warn('🌐 BROWSER GOLD: could not record the charge on the step', {
                        stepId,
                        error: error.message,
                    })
                })
        }

        if (result?.success !== true) {
            console.warn('🌐 BROWSER GOLD: the step could not be charged', {
                userId,
                runId,
                stepId,
                message: result?.message,
            })
        }
        return { charged, alreadyProcessed: result?.alreadyProcessed === true, result }
    } catch (error) {
        console.error('🌐 BROWSER GOLD: charge threw', { userId, runId, stepId, error: error.message })
        return { charged: false, error: error.message }
    }
}

module.exports = {
    BROWSER_GOLD_SOURCE,
    BROWSER_STEP_GOLD,
    buildIdempotencyKey,
    chargeGoldForBrowserStep,
    hasGoldForBrowserStep,
}
