import {
    getVmSessionBadgeState,
    getVmSessionDocId,
    VM_BADGE_STATE_FAILED,
    VM_BADGE_STATE_IN_PROGRESS,
    VM_BADGE_STATE_PAUSED,
    VM_SESSION_STATUS_BUSY,
    VM_SESSION_STATUS_IDLE_RUNNING,
    VM_SESSION_STATUS_PAUSED,
    VM_SESSION_STATUS_RUNNING,
} from './vmSessionStatus'

jest.mock('../firestore', () => ({ getDb: jest.fn() }))

describe('VM session status', () => {
    test('maps a busy session to an in-progress badge', () => {
        expect(getVmSessionBadgeState({ status: VM_SESSION_STATUS_BUSY })).toBe(VM_BADGE_STATE_IN_PROGRESS)
    })

    test.each([VM_SESSION_STATUS_IDLE_RUNNING, VM_SESSION_STATUS_PAUSED])(
        'maps resumable status %s to a paused badge',
        status => expect(getVmSessionBadgeState({ status })).toBe(VM_BADGE_STATE_PAUSED)
    )

    test.each([{ status: 'paused' }, { status: 'paused', objectType: 'tasks', lastRunStatus: 'completed' }])(
        'maps persisted paused session shape to a paused badge',
        session => {
            expect(getVmSessionBadgeState(session)).toBe(VM_BADGE_STATE_PAUSED)
        }
    )

    test.each([
        { status: 'failed' },
        { status: VM_SESSION_STATUS_IDLE_RUNNING, lastRunStatus: 'failed' },
        { status: VM_SESSION_STATUS_PAUSED, lastRunStatus: 'failed' },
    ])('maps a failed session to a failed badge', session => {
        expect(getVmSessionBadgeState(session)).toBe(VM_BADGE_STATE_FAILED)
    })

    test.each([
        'stopped',
        'completed',
        'cancelled',
        VM_SESSION_STATUS_RUNNING,
        'unexpected',
        null,
        undefined,
    ])('hides terminal, unknown, or missing status %s', status =>
        expect(getVmSessionBadgeState(status && { status })).toBeNull()
    )

    test('busy takes precedence over stale failure metadata', () => {
        expect(getVmSessionBadgeState({ status: VM_SESSION_STATUS_BUSY, lastRunStatus: 'failed' })).toBe(
            VM_BADGE_STATE_IN_PROGRESS
        )
    })

    test('uses the same project and object session key as the VM runner', () => {
        expect(getVmSessionDocId('project-1', 'task-1')).toBe('project-1__task-1')
    })
})
