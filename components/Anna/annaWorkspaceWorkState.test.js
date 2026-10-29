import { getAnnaWorkspaceWorkState } from './annaWorkspaceWorkState'

const messages = (...runs) =>
    Object.assign(
        runs.map(assistantRun => ({ assistantRun })),
        { loaded: true }
    )
it('requires a persisted successful completion, including every run for the same request', () => {
    expect(getAnnaWorkspaceWorkState([])).toEqual({ busy: true, running: false, completedRequests: [] })
    expect(getAnnaWorkspaceWorkState(messages({ triggerMessageId: 'm1', status: 'completed' }))).toEqual({
        busy: false,
        running: false,
        completedRequests: ['m1'],
    })
    expect(
        getAnnaWorkspaceWorkState(
            messages(
                { triggerMessageId: 'm1', status: 'completed' },
                { triggerMessageId: 'm1', kind: 'vm_job', status: 'awaiting_user' }
            )
        )
    ).toEqual({ busy: true, running: false, completedRequests: [] })
})
it.each(['failed', 'cancelled', 'incomplete', 'running', 'queued', 'awaiting_user'])(
    'never treats %s as a completed request',
    status => {
        expect(getAnnaWorkspaceWorkState(messages({ triggerMessageId: 'm1', status })).completedRequests).toEqual([])
    }
)
it('keeps other ongoing work and streaming responses busy, even when another request completed', () => {
    const state = messages({ triggerMessageId: 'm1', status: 'completed' })
    state.push({ fromAssistant: true, isLoading: true })
    expect(getAnnaWorkspaceWorkState(state)).toEqual({ busy: true, running: true, completedRequests: ['m1'] })
})
it('only reports running for an answer in progress, not VM jobs, waiting runs or an unloaded thread', () => {
    expect(getAnnaWorkspaceWorkState([]).running).toBe(false)
    expect(getAnnaWorkspaceWorkState(messages({ triggerMessageId: 'm1', status: 'running' })).running).toBe(true)
    expect(getAnnaWorkspaceWorkState(messages({ triggerMessageId: 'm1', status: 'queued' })).running).toBe(true)
    expect(
        getAnnaWorkspaceWorkState(messages({ triggerMessageId: 'm1', kind: 'vm_job', status: 'running' })).running
    ).toBe(false)
    expect(getAnnaWorkspaceWorkState(messages({ triggerMessageId: 'm1', status: 'awaiting_user' })).running).toBe(false)
    expect(getAnnaWorkspaceWorkState(messages({ triggerMessageId: 'm1', status: 'completed' })).running).toBe(false)
})
