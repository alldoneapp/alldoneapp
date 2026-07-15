import {
    getVmSessionDocId,
    getVmSessionBadgeState,
    VM_SESSION_BADGE_ACTIVE,
    VM_SESSION_BADGE_PAUSED,
    VM_SESSION_STATUS_BUSY,
    VM_SESSION_STATUS_IDLE_RUNNING,
    VM_SESSION_STATUS_PAUSED,
} from './vmSessionStatus'

jest.mock('../firestore', () => ({ getDb: jest.fn() }))

describe('VM session status', () => {
    test('maps a busy leased session to the active badge', () => {
        expect(getVmSessionBadgeState(VM_SESSION_STATUS_BUSY)).toBe(VM_SESSION_BADGE_ACTIVE)
    })

    test.each([
        VM_SESSION_STATUS_IDLE_RUNNING,
        VM_SESSION_STATUS_PAUSED,
    ])('maps resumable %s sessions to the paused badge', status =>
        expect(getVmSessionBadgeState(status)).toBe(VM_SESSION_BADGE_PAUSED)
    )

    test.each([
        'running',
        'stopped',
        'failed',
        'completed',
        'unknown',
        null,
        undefined,
    ])('does not map terminal, legacy, missing, or unknown status %s to a badge', status =>
        expect(getVmSessionBadgeState(status)).toBeNull()
    )

    test('uses the same project and object session key as the VM runner', () => {
        expect(getVmSessionDocId('project-1', 'task-1')).toBe('project-1__task-1')
    })
})
