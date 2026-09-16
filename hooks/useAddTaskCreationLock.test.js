import { createAddTaskCreationLock } from './useAddTaskCreationLock'

jest.mock('../redux/actions', () => ({
    startAddTaskCreation: () => ({ type: 'Start add task creation' }),
    finishAddTaskCreation: () => ({ type: 'Finish add task creation' }),
}))

describe('createAddTaskCreationLock', () => {
    it('counts one active flow despite repeated opens and releases once', () => {
        const dispatch = jest.fn()
        const lock = createAddTaskCreationLock(dispatch)

        lock.acquire()
        lock.acquire()
        lock.release()
        lock.release()

        expect(dispatch.mock.calls.map(([action]) => action.type)).toEqual([
            'Start add task creation',
            'Finish add task creation',
        ])
        expect(lock.isAcquired()).toBe(false)
    })
})
