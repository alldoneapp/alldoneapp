import { getAnnaWorkspaceWorkState } from './annaWorkspaceWorkState'

const messages = (...runs) =>
    Object.assign(
        runs.map(assistantRun => ({ assistantRun })),
        { loaded: true }
    )
it('requires a persisted successful completion, including every run for the same request', () => {
    expect(getAnnaWorkspaceWorkState([])).toEqual({ busy: true, changingWorkspace: false, completedRequests: [] })
    expect(getAnnaWorkspaceWorkState(messages({ triggerMessageId: 'm1', status: 'completed' }))).toEqual({
        busy: false,
        changingWorkspace: false,
        completedRequests: ['m1'],
    })
    expect(
        getAnnaWorkspaceWorkState(
            messages(
                { triggerMessageId: 'm1', status: 'completed' },
                { triggerMessageId: 'm1', kind: 'vm_job', status: 'awaiting_user' }
            )
        )
    ).toEqual({ busy: true, changingWorkspace: false, completedRequests: [] })
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
    expect(getAnnaWorkspaceWorkState(state)).toEqual({
        busy: true,
        changingWorkspace: false,
        completedRequests: ['m1'],
    })
})
describe('changingWorkspace (AT-2926)', () => {
    const change = { phase: 'tool', toolName: 'create_task', changesWorkspace: true }
    const read = { phase: 'tool', toolName: 'get_tasks', changesWorkspace: false }
    const state = (...runs) => getAnnaWorkspaceWorkState(messages(...runs)).changingWorkspace

    it('is true only while a workspace-changing tool call executes on a live run', () => {
        expect(state({ triggerMessageId: 'm1', status: 'running', activity: change })).toBe(true)
    })

    it('stays false while the assistant is merely active, thinking or streaming an answer', () => {
        expect(state({ triggerMessageId: 'm1', status: 'running' })).toBe(false)
        expect(state({ triggerMessageId: 'm1', status: 'queued' })).toBe(false)
        expect(state({ triggerMessageId: 'm1', status: 'running', activity: { phase: 'thinking' } })).toBe(false)
        expect(state({ triggerMessageId: 'm1', status: 'running', activity: { phase: 'composing' } })).toBe(false)
        const streaming = messages({ triggerMessageId: 'm1', status: 'running' })
        streaming.push({ fromAssistant: true, isLoading: true })
        expect(getAnnaWorkspaceWorkState(streaming).changingWorkspace).toBe(false)
    })

    it('stays false for read-only tools and for activity written before the flag existed', () => {
        expect(state({ triggerMessageId: 'm1', status: 'running', activity: read })).toBe(false)
        expect(
            state({ triggerMessageId: 'm1', status: 'running', activity: { phase: 'tool', toolName: 'create_task' } })
        ).toBe(false)
    })

    it.each(['completed', 'failed', 'cancelled', 'incomplete', 'expired', 'awaiting_user'])(
        'clears once the run is %s, even if the last activity was a change',
        status => {
            expect(state({ triggerMessageId: 'm1', status, activity: change })).toBe(false)
        }
    )

    it('never counts VM jobs or an unloaded thread', () => {
        expect(state({ triggerMessageId: 'm1', kind: 'vm_job', status: 'running', activity: change })).toBe(false)
        expect(getAnnaWorkspaceWorkState([]).changingWorkspace).toBe(false)
    })

    it('stays lit while any overlapping run is still changing the workspace', () => {
        expect(
            state(
                { triggerMessageId: 'm1', status: 'completed', activity: change },
                { triggerMessageId: 'm2', status: 'running', activity: { phase: 'composing' } },
                { triggerMessageId: 'm3', status: 'running', activity: change }
            )
        ).toBe(true)
        expect(
            state(
                { triggerMessageId: 'm2', status: 'running', activity: { phase: 'composing' } },
                { triggerMessageId: 'm3', status: 'running', activity: read }
            )
        ).toBe(false)
    })
})
