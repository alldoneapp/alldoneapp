/**
 * AT-2240: a continued/resumed VM run keeps the agent its session was started with.
 *
 * These are the decision-level tests (pure function, no Firestore). The dispatch-level wiring —
 * that `startVmJob` actually asks this and writes the pinned agent onto the job — is covered in
 * vmJob.test.js.
 */

const {
    VALID_VM_AGENTS,
    REUSABLE_SESSION_STATUSES,
    agentForModelSelection,
    hasResumableVmSandbox,
    isVmThreadRunOccupied,
    resolveVmThreadAgentContinuity,
} = require('./vmThreadAgentContinuity')

const NOW = 1_800_000_000_000

function pausedSession(overrides = {}) {
    return { agent: 'claude', sandboxId: 'sbx-1', status: 'paused', ...overrides }
}

describe('vmThreadAgentContinuity', () => {
    describe('agent list', () => {
        test('does not drift from the authoritative agent list', () => {
            // The module keeps a local copy to stay dependency-free (same precedent as
            // vmRunOverrideGuard). If a new agent is added to vmAgentSettings and not here, it would
            // silently lose thread continuity, so pin the two together.
            jest.isolateModules(() => {
                jest.doMock('firebase-admin', () => ({ firestore: jest.fn() }), { virtual: true })
                const { VALID_VM_AGENTS: authoritative } = require('./vmAgentSettings')
                expect([...VALID_VM_AGENTS].sort()).toEqual([...authoritative].sort())
            })
        })
    })

    describe('resolveVmThreadAgentContinuity', () => {
        test('pins a follow-up to the agent of the thread’s paused sandbox', () => {
            const result = resolveVmThreadAgentContinuity({ session: pausedSession(), now: NOW })

            expect(result).toEqual({
                agent: 'claude',
                pinned: true,
                sessionAgent: 'claude',
                reason: 'resumable_sandbox',
            })
        })

        test('pins for a kept-alive (idle_running) sandbox too', () => {
            const result = resolveVmThreadAgentContinuity({
                session: pausedSession({ agent: 'codex', status: 'idle_running' }),
                now: NOW,
            })

            expect(result).toMatchObject({ agent: 'codex', pinned: true })
        })

        test('treats a session with no status as the legacy paused shape', () => {
            const result = resolveVmThreadAgentContinuity({
                session: { agent: 'codex', sandboxId: 'sbx-1' },
                now: NOW,
            })

            expect(result).toMatchObject({ agent: 'codex', pinned: true })
        })

        test('pins a job that will queue behind a live run on the thread', () => {
            // No resumable sandbox right now (the running job owns it), but the queued follow-up
            // inherits exactly that sandbox when the thread drains.
            const result = resolveVmThreadAgentContinuity({
                session: {
                    agent: 'codex',
                    status: 'running',
                    activeLeaseOwner: 'other-job-uuid',
                    activeCorrelationId: 'other-job',
                    activeLeaseExpiresAt: NOW + 60_000,
                },
                now: NOW,
            })

            expect(result).toMatchObject({ agent: 'codex', pinned: true, reason: 'active_thread_run' })
        })

        test('pins when jobs are already waiting in the thread queue', () => {
            const result = resolveVmThreadAgentContinuity({
                session: { agent: 'claude', queue: ['queued-1'], queueLength: 1 },
                now: NOW,
            })

            expect(result).toMatchObject({ agent: 'claude', pinned: true, reason: 'active_thread_run' })
        })

        test('pins while a run is blocked on a user interaction', () => {
            // Its runtime lease is released while E2B is paused, but it still owns the thread.
            const result = resolveVmThreadAgentContinuity({
                session: { agent: 'claude', blockedByCorrelationId: 'asking-job' },
                now: NOW,
            })

            expect(result).toMatchObject({ agent: 'claude', pinned: true, reason: 'active_thread_run' })
        })

        test('does not pin when the sandbox is gone and nothing is running', () => {
            // The session doc outlives its sandbox for up to 7 days. With nothing to resume, the
            // next run is a cold start — a genuinely new run, which follows current settings.
            const result = resolveVmThreadAgentContinuity({
                session: { agent: 'claude', sandboxId: null, status: 'paused', lastRunStatus: 'completed' },
                now: NOW,
            })

            expect(result).toEqual({
                agent: null,
                pinned: false,
                sessionAgent: 'claude',
                reason: 'session_not_continuable',
            })
        })

        test('does not pin to a legacy `running` session the runner would discard anyway', () => {
            const result = resolveVmThreadAgentContinuity({
                session: { agent: 'claude', sandboxId: 'sbx-1', status: 'running' },
                now: NOW,
            })

            expect(result).toMatchObject({ agent: null, pinned: false, reason: 'session_not_continuable' })
        })

        test('does not pin when the lease that held the thread has expired', () => {
            const result = resolveVmThreadAgentContinuity({
                session: {
                    agent: 'codex',
                    activeLeaseOwner: 'dead-job-uuid',
                    activeLeaseExpiresAt: NOW - 1,
                    queue: [],
                },
                now: NOW,
            })

            expect(result).toMatchObject({ agent: null, pinned: false })
        })

        test('does not pin when there is no session at all (a brand-new thread)', () => {
            expect(resolveVmThreadAgentContinuity({ session: null, now: NOW })).toEqual({
                agent: null,
                pinned: false,
                sessionAgent: null,
                reason: 'no_session',
            })
        })

        test('does not pin on a legacy session doc that never recorded an agent', () => {
            const result = resolveVmThreadAgentContinuity({
                session: { sandboxId: 'sbx-1', status: 'paused' },
                now: NOW,
            })

            expect(result).toEqual({
                agent: null,
                pinned: false,
                sessionAgent: null,
                reason: 'session_without_agent',
            })
        })

        test('ignores an unrecognised agent value on the session', () => {
            const result = resolveVmThreadAgentContinuity({
                session: pausedSession({ agent: 'not-an-agent' }),
                now: NOW,
            })

            expect(result).toMatchObject({ agent: null, pinned: false, reason: 'session_without_agent' })
        })

        test('a corroborated per-run agent request still wins over the session', () => {
            // AT-2224 already filtered this: an assistant-invented `agent` never reaches here.
            const result = resolveVmThreadAgentContinuity({
                session: pausedSession({ agent: 'codex' }),
                requestedAgent: 'claude',
                now: NOW,
            })

            expect(result).toEqual({
                agent: 'claude',
                pinned: false,
                sessionAgent: 'codex',
                reason: 'explicit_agent_request',
            })
        })

        test('steps aside when the user asked for a model belonging to the other agent', () => {
            // "do this one with opus" on a Codex thread: pinning to codex would fail model
            // validation instead of honouring the request.
            const result = resolveVmThreadAgentContinuity({
                session: pausedSession({ agent: 'codex' }),
                requestedAgentModel: 'opus',
                now: NOW,
            })

            expect(result).toMatchObject({ agent: null, pinned: false, reason: 'model_request_for_other_agent' })
        })

        test('still pins when the requested model belongs to the session’s own agent', () => {
            const result = resolveVmThreadAgentContinuity({
                session: pausedSession({ agent: 'codex' }),
                requestedAgentModel: 'gpt-5.6-terra',
                now: NOW,
            })

            expect(result).toMatchObject({ agent: 'codex', pinned: true })
        })

        test('an OpenRouter model keeps a Codex thread pinned (it runs through Codex)', () => {
            const result = resolveVmThreadAgentContinuity({
                session: pausedSession({ agent: 'codex' }),
                requestedAgentModel: 'openrouter:deepseek/deepseek-chat',
                now: NOW,
            })

            expect(result).toMatchObject({ agent: 'codex', pinned: true })
        })

        test('is defensive about being called with nothing', () => {
            expect(resolveVmThreadAgentContinuity()).toMatchObject({ agent: null, pinned: false })
        })
    })

    describe('helpers', () => {
        test('agentForModelSelection maps model flavours to their agent', () => {
            expect(agentForModelSelection('opus')).toBe('claude')
            expect(agentForModelSelection('claude-fable-5')).toBe('claude')
            expect(agentForModelSelection('gpt-5.6-sol')).toBe('codex')
            expect(agentForModelSelection('o3-mini')).toBe('codex')
            expect(agentForModelSelection('openrouter:deepseek/deepseek-chat')).toBe('codex')
            expect(agentForModelSelection('')).toBeNull()
            expect(agentForModelSelection(undefined)).toBeNull()
            expect(agentForModelSelection('something-else')).toBeNull()
        })

        test('hasResumableVmSandbox mirrors the runner’s reuse states', () => {
            for (const status of REUSABLE_SESSION_STATUSES) {
                expect(hasResumableVmSandbox({ sandboxId: 'sbx-1', status })).toBe(true)
            }
            expect(hasResumableVmSandbox({ sandboxId: 'sbx-1', status: 'running' })).toBe(false)
            expect(hasResumableVmSandbox({ status: 'paused' })).toBe(false)
            expect(hasResumableVmSandbox(null)).toBe(false)
        })

        test('isVmThreadRunOccupied only counts live holders', () => {
            expect(isVmThreadRunOccupied({ activeLeaseOwner: 'x', activeLeaseExpiresAt: NOW + 1 }, NOW)).toBe(true)
            expect(isVmThreadRunOccupied({ activeLeaseOwner: 'x', activeLeaseExpiresAt: NOW - 1 }, NOW)).toBe(false)
            expect(isVmThreadRunOccupied({ queue: ['a'] }, NOW)).toBe(true)
            expect(isVmThreadRunOccupied({ blockedByCorrelationId: 'a' }, NOW)).toBe(true)
            expect(isVmThreadRunOccupied({}, NOW)).toBe(false)
            expect(isVmThreadRunOccupied(null, NOW)).toBe(false)
        })
    })
})
