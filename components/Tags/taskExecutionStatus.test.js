import {
    EXECUTION_STATE_ACTIVE,
    EXECUTION_STATE_AWAITING_USER,
    EXECUTION_STATE_NEEDS_ATTENTION,
    EXECUTION_STATE_PAUSED,
    EXECUTION_STATE_QUEUED,
    getVmStatusDetails,
    resolveTaskExecutionStatus,
} from './taskExecutionStatus'

const run = status => ({ workflowAiStatus: { runId: 'run-1', stepId: 'build', status } })
const stateOf = (task, session) => resolveTaskExecutionStatus({ task, session })?.state ?? null

describe('resolveTaskExecutionStatus (AT-3099)', () => {
    describe('the combinations that used to show two contradicting chips', () => {
        test.each([
            ['running step + paused VM', run('running'), { status: 'paused' }, EXECUTION_STATE_ACTIVE],
            ['running step + idle VM', run('running'), { status: 'idle_running' }, EXECUTION_STATE_ACTIVE],
            ['awaiting_vm step + paused VM', run('awaiting_vm'), { status: 'paused' }, EXECUTION_STATE_ACTIVE],
            ['pending step + paused VM', run('pending'), { status: 'paused' }, EXECUTION_STATE_QUEUED],
            ['pending step + busy VM', run('pending'), { status: 'busy' }, EXECUTION_STATE_ACTIVE],
            ['failed step + busy VM', run('failed'), { status: 'busy' }, EXECUTION_STATE_ACTIVE],
            ['failed step + paused VM', run('failed'), { status: 'paused' }, EXECUTION_STATE_NEEDS_ATTENTION],
            [
                'running step + VM asking a question',
                run('awaiting_vm'),
                { status: 'paused', lastRunStatus: 'awaiting_user', blockedByCorrelationId: 'job-1' },
                EXECUTION_STATE_AWAITING_USER,
            ],
            [
                'running step + old failed VM run',
                run('running'),
                { status: 'paused', lastRunStatus: 'failed' },
                EXECUTION_STATE_ACTIVE,
            ],
        ])('%s resolves to one state', (_, task, session, expected) => {
            expect(stateOf(task, session)).toBe(expected)
        })
    })

    describe('workflow run only', () => {
        test.each([
            ['pending', EXECUTION_STATE_QUEUED],
            ['running', EXECUTION_STATE_ACTIVE],
            ['awaiting_vm', EXECUTION_STATE_ACTIVE],
            ['failed', EXECUTION_STATE_NEEDS_ATTENTION],
            ['completed', null],
            ['skipped', null],
        ])('%s', (status, expected) => {
            expect(stateOf(run(status), null)).toBe(expected)
        })

        it('only a failed workflow step is retryable', () => {
            expect(resolveTaskExecutionStatus({ task: run('failed') }).retryable).toBe(true)
            expect(resolveTaskExecutionStatus({ task: run('running') }).retryable).toBe(false)
            expect(resolveTaskExecutionStatus({ task: {}, session: { status: 'failed' } }).retryable).toBe(false)
        })
    })

    describe('VM session only', () => {
        test.each([
            [{ status: 'busy' }, EXECUTION_STATE_ACTIVE],
            [{ status: 'idle_running' }, EXECUTION_STATE_PAUSED],
            [{ status: 'paused' }, EXECUTION_STATE_PAUSED],
            [{ status: 'paused', lastRunStatus: 'completed' }, EXECUTION_STATE_PAUSED],
            [{ status: 'failed' }, EXECUTION_STATE_NEEDS_ATTENTION],
            [{ status: 'paused', lastRunStatus: 'failed' }, EXECUTION_STATE_NEEDS_ATTENTION],
            [{ status: 'idle_running', lastRunStatus: 'interrupted' }, EXECUTION_STATE_NEEDS_ATTENTION],
            [{ status: 'paused', blockedByCorrelationId: 'job-1' }, EXECUTION_STATE_AWAITING_USER],
            [{ status: 'paused', queue: ['job-2'], queueLength: 1 }, EXECUTION_STATE_QUEUED],
            [{ status: 'idle_running', queueLength: 2 }, EXECUTION_STATE_QUEUED],
            [{ status: 'busy', queue: ['job-2'] }, EXECUTION_STATE_ACTIVE],
            [{ status: 'stopped' }, null],
            [{ status: 'completed' }, null],
            [null, null],
        ])('%j', (session, expected) => {
            expect(stateOf({}, session)).toBe(expected)
        })

        // The question expired or was cancelled: `blockedByCorrelationId` was cleared, the stale
        // `lastRunStatus` was not. The task is no longer waiting on the user.
        it('does not keep saying "waiting for you" after the question is gone', () => {
            expect(
                stateOf({}, { status: 'paused', lastRunStatus: 'awaiting_user', blockedByCorrelationId: null })
            ).toBe(EXECUTION_STATE_PAUSED)
        })
    })

    describe('done tasks', () => {
        it('ignores the workflow run of a done task', () => {
            expect(stateOf({ ...run('failed'), done: true }, null)).toBeNull()
            expect(stateOf({ ...run('running'), done: true }, null)).toBeNull()
        })

        it('still shows a retained VM session as paused', () => {
            expect(stateOf({ ...run('running'), done: true }, { status: 'paused' })).toBe(EXECUTION_STATE_PAUSED)
        })
    })
})

describe('getVmStatusDetails', () => {
    it('describes a retained session with the continuation hint', () => {
        expect(getVmStatusDetails({ status: 'paused' })).toEqual([
            { key: 'vm_status_detail_session', params: { stateKey: 'vm_workspace_paused' } },
            { key: 'vm_workspace_paused_hint' },
        ])
    })

    it('names the question, the failed run and the queue', () => {
        expect(getVmStatusDetails({ status: 'paused', blockedByCorrelationId: 'job-1', queueLength: 2 })).toEqual([
            { key: 'vm_workspace_awaiting' },
            { key: 'vm_status_detail_session', params: { stateKey: 'vm_workspace_paused' } },
            { key: 'vm_workspace_waiting', params: { count: 2 } },
        ])
        expect(getVmStatusDetails({ status: 'idle_running', lastRunStatus: 'failed' })).toEqual([
            { key: 'vm_status_detail_session', params: { stateKey: 'vm_status_detail_idle' } },
            { key: 'vm_status_detail_last_run_failed' },
        ])
    })

    it('is empty without a session', () => {
        expect(getVmStatusDetails(null)).toEqual([])
    })
})
