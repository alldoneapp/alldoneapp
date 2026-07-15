import {
    getVmSessionDocId,
    isVmSessionActiveOrWarm,
    VM_SESSION_STATUS_BUSY,
    VM_SESSION_STATUS_IDLE_RUNNING,
    VM_SESSION_STATUS_RUNNING,
} from './vmSessionStatus'

jest.mock('../firestore', () => ({ getDb: jest.fn() }))

describe('VM session status', () => {
    test.each([VM_SESSION_STATUS_BUSY, VM_SESSION_STATUS_IDLE_RUNNING, VM_SESSION_STATUS_RUNNING])(
        'maps %s to an active or warm VM',
        status => {
            expect(isVmSessionActiveOrWarm(status)).toBe(true)
        }
    )

    test.each(['paused', 'stopped', 'failed', null, undefined])('does not map %s to a visible VM', status => {
        expect(isVmSessionActiveOrWarm(status)).toBe(false)
    })

    test('uses the same project and object session key as the VM runner', () => {
        expect(getVmSessionDocId('project-1', 'task-1')).toBe('project-1__task-1')
    })
})
