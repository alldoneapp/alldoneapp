/**
 * Keep a continued/resumed VM run on the agent it started with (AT-2240).
 *
 * A chat thread owns exactly one VM sandbox (`vmSessions/{projectId}__{objectId}`), and a
 * follow-up `execute_task_in_vm` on that thread is expected to *continue* it: the runner resumes
 * the paused/kept-alive sandbox and re-enters the agent's own session store (`claude --continue`,
 * `codex exec resume --last`), so files and conversation survive.
 *
 * The agent was nevertheless re-resolved from scratch on every dispatch — corroborated tool
 * override, then the user's saved Settings → Integrations default, then the system default — with
 * nothing looking at what the thread was actually running. Changing that default therefore silently
 * switched a *running conversation* to the other agent, and the switch is destructive rather than
 * cosmetic: the runner refuses to hand a Codex sandbox to Claude (their session stores are not
 * interchangeable), so it kills the sandbox, drops the checkout and the whole agent conversation,
 * and starts cold. The user asked for "continue", read "🖥️ Spinning up Codex…", and lost the work
 * the thread was built on. The reverse — a user who changes their default *because* the next run
 * should differ — is served by starting a new thread, or by saying so in the request.
 *
 * So: on a genuine continuation the thread's recorded agent wins over the saved default, and only
 * over the saved default. Precedence becomes
 *
 *     corroborated per-run request  >  the thread's existing agent  >  saved default  >  system default
 *
 * with the first term unchanged from AT-2224 — asking for "run this one with Codex" still works,
 * on a continued thread as everywhere else, and is then the deliberate cold restart it reads as.
 *
 * Two deliberate limits:
 *   - Only the *agent* is pinned. Model family, reasoning effort and the credential route
 *     (Gold / BYOK / subscription) are re-resolved per run exactly as before: none of them
 *     invalidates a session — the same CLI resumes the same store — and freezing them would mean a
 *     thread could never pick up a model upgrade or a re-connected key.
 *   - "Continuation" is a state, not a time window. The pin applies while the thread still has
 *     something to continue: a resumable sandbox, or a run in flight/queued whose sandbox this job
 *     will inherit. Once the sandbox is gone the next run is a cold start by definition, and a cold
 *     start is a new run — it follows the current settings, which is the behaviour to preserve.
 *
 * Pure and dependency-free (the caller passes the already-read session document) so the decision is
 * unit-testable without Firestore, and so requiring it can never drag firebase-admin into a caller.
 */

// Local copy on purpose: importing vmAgentSettings for this would pull firebase-admin in behind it.
// vmThreadAgentContinuity.test.js asserts this list against vmAgentSettings.VALID_VM_AGENTS, so a
// future agent cannot be added there and silently lose thread continuity here.
const VALID_VM_AGENTS = ['claude', 'codex']

// Session states whose sandbox the runner will actually resume (mirrors `isReusableVmSession` in
// vmJobRunner.js). A missing status is the legacy paused shape. `running` is deliberately absent:
// it is the pre-lease legacy state the runner discards rather than reuses.
const REUSABLE_SESSION_STATUSES = ['paused', 'idle_running']

function isValidVmAgent(agent) {
    return typeof agent === 'string' && VALID_VM_AGENTS.includes(agent)
}

/**
 * The agent a model selection implies. `openrouter:` models run through the Codex harness
 * (AT-2230), Claude aliases and `claude-*` ids through Claude Code.
 */
function agentForModelSelection(model) {
    const trimmed = typeof model === 'string' ? model.trim().toLowerCase() : ''
    if (!trimmed) return null
    if (trimmed.startsWith('openrouter:')) return 'codex'
    if (trimmed.startsWith('claude-') || ['opus', 'sonnet', 'haiku', 'fable'].includes(trimmed)) return 'claude'
    if (trimmed.startsWith('gpt-') || /^o\d/.test(trimmed)) return 'codex'
    return null
}

/**
 * Is there a paused/kept-alive sandbox on this thread that the next run would resume?
 */
function hasResumableVmSandbox(session) {
    if (!session || !session.sandboxId) return false
    return REUSABLE_SESSION_STATUSES.includes(session.status || 'paused')
}

/**
 * Is a run in flight (or waiting) on this thread? Such a job holds the thread's sandbox, and the
 * incoming job is queued behind it and runs on that same sandbox — which is a continuation even
 * though the session is not resumable *right now*.
 *
 * Mirrors the occupancy terms of `admitVmJobToThread`, minus the self-correlation checks: this runs
 * before the new job has a correlationId, so every live holder is by definition another job.
 */
function isVmThreadRunOccupied(session, nowMs = Date.now()) {
    if (!session) return false
    const activeLeaseOwner = session.activeLeaseOwner || null
    const activeLeaseExpiresAt = Number(session.activeLeaseExpiresAt) || 0
    const queue = Array.isArray(session.queue) ? session.queue : []
    // A job paused for a question/plan approval keeps the thread even with its runtime lease
    // released, so it counts as occupied (see blockVmThreadForInteraction).
    if (session.blockedByCorrelationId) return true
    if (activeLeaseOwner && activeLeaseExpiresAt > nowMs) return true
    return queue.length > 0
}

/**
 * Decide which agent a dispatch should be pinned to, if any.
 *
 * @param {object} params
 * @param {object|null} params.session The thread's `vmSessions` document data (null when none).
 * @param {string} [params.requestedAgent] The *corroborated* per-run agent override (AT-2224), i.e.
 *   already filtered by vmRunOverrideGuard — an assistant-invented value must never reach this.
 * @param {string} [params.requestedAgentModel] The corroborated per-run model override, used only to
 *   step aside when the user asked for a model belonging to the other agent ("do it with opus" on a
 *   Codex thread): pinning there would reject the run instead of honouring the request.
 * @param {number} [params.now] Injectable clock for tests.
 * @returns {{agent: string|null, pinned: boolean, sessionAgent: string|null, reason: string}}
 *   `agent` is what to treat as the explicit choice: the request when there is one, the thread's
 *   agent when pinning, otherwise null → resolve from the user's saved default as before.
 */
function resolveVmThreadAgentContinuity({ session, requestedAgent, requestedAgentModel, now = Date.now() } = {}) {
    const sessionAgent = isValidVmAgent(session?.agent) ? session.agent : null

    // An explicit, corroborated request outranks everything — including the thread's history. This
    // is the user deliberately switching agents mid-thread, and the cold restart that follows is the
    // documented cost of it.
    if (isValidVmAgent(requestedAgent)) {
        return { agent: requestedAgent, pinned: false, sessionAgent, reason: 'explicit_agent_request' }
    }

    if (!session) return { agent: null, pinned: false, sessionAgent: null, reason: 'no_session' }
    if (!sessionAgent) {
        // Legacy/partial session doc (written before the agent was recorded, or a doc that only ever
        // held queue state). Nothing to pin to — fall back to the saved default, i.e. today's
        // behaviour, rather than guessing.
        return { agent: null, pinned: false, sessionAgent: null, reason: 'session_without_agent' }
    }

    const requestedModelAgent = agentForModelSelection(requestedAgentModel)
    if (requestedModelAgent && requestedModelAgent !== sessionAgent) {
        // The user asked for a model this thread's agent cannot run. Stepping aside keeps the run
        // working (it resolves normally, and normalizeAgentModel then pairs the model with its own
        // agent) instead of failing validation on a pin the user never asked for.
        return { agent: null, pinned: false, sessionAgent, reason: 'model_request_for_other_agent' }
    }

    if (hasResumableVmSandbox(session)) {
        return { agent: sessionAgent, pinned: true, sessionAgent, reason: 'resumable_sandbox' }
    }
    if (isVmThreadRunOccupied(session, now)) {
        // Queued behind a live run: it inherits that run's sandbox when the thread drains.
        return { agent: sessionAgent, pinned: true, sessionAgent, reason: 'active_thread_run' }
    }

    // The session doc outlives its sandbox (it is pruned after 7 idle days). With no sandbox and no
    // run to queue behind, the next job starts cold — a new run, which follows current settings.
    return { agent: null, pinned: false, sessionAgent, reason: 'session_not_continuable' }
}

module.exports = {
    VALID_VM_AGENTS,
    REUSABLE_SESSION_STATUSES,
    agentForModelSelection,
    hasResumableVmSandbox,
    isVmThreadRunOccupied,
    resolveVmThreadAgentContinuity,
}
