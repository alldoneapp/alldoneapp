import { completeEmailLinkedTask } from './emailTaskCompletion'

describe('completeEmailLinkedTask', () => {
    const archiveData = { connectionProjectId: 'connection-1', messageIds: ['message-1'] }

    afterEach(() => {
        jest.useRealTimers()
    })

    test('completes the task immediately while the linked email archives in the background', async () => {
        const events = []
        let finishArchive
        const archiveEmailAction = jest.fn().mockImplementation(
            () =>
                new Promise(resolve => {
                    finishArchive = () => {
                        events.push('archive')
                        resolve()
                    }
                })
        )
        const completeTask = jest.fn(() => events.push('complete'))

        const archiveRequest = completeEmailLinkedTask({
            archiveEmail: true,
            archiveData,
            archiveEmailAction,
            completeTask,
        })

        expect(archiveEmailAction).toHaveBeenCalledWith('connection-1', {
            action: 'archive',
            messageIds: ['message-1'],
        })
        expect(completeTask).toHaveBeenCalledTimes(1)
        expect(events).toEqual(['complete'])

        finishArchive()
        await archiveRequest
        expect(events).toEqual(['complete', 'archive'])
    })

    test('completes the task without changing the linked email', async () => {
        const archiveEmailAction = jest.fn()
        const completeTask = jest.fn()

        await completeEmailLinkedTask({ archiveEmail: false, archiveData, archiveEmailAction, completeTask })

        expect(archiveEmailAction).not.toHaveBeenCalled()
        expect(completeTask).toHaveBeenCalledTimes(1)
    })

    test('keeps the completed task when a non-transient archive error is reported', async () => {
        const error = Object.assign(new Error('authentication expired'), { code: 'functions/permission-denied' })
        const archiveEmailAction = jest.fn().mockRejectedValue(error)
        const completeTask = jest.fn()

        await expect(
            completeEmailLinkedTask({ archiveEmail: true, archiveData, archiveEmailAction, completeTask })
        ).rejects.toBe(error)
        expect(completeTask).toHaveBeenCalledTimes(1)
    })

    test('retries a transient archive failure once without completing twice', async () => {
        const error = Object.assign(new Error('temporarily unavailable'), { code: 'functions/unavailable' })
        const archiveEmailAction = jest.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined)
        const completeTask = jest.fn()

        const archiveRequest = completeEmailLinkedTask({
            archiveEmail: true,
            archiveData,
            archiveEmailAction,
            completeTask,
        })
        await archiveRequest

        expect(archiveEmailAction).toHaveBeenCalledTimes(2)
        expect(completeTask).toHaveBeenCalledTimes(1)
    })

    test('deduplicates concurrent archive requests for the same messages', async () => {
        let finishArchive
        const archiveEmailAction = jest.fn(
            () =>
                new Promise(resolve => {
                    finishArchive = resolve
                })
        )
        const firstCompleteTask = jest.fn()
        const secondCompleteTask = jest.fn()

        const firstRequest = completeEmailLinkedTask({
            archiveEmail: true,
            archiveData,
            archiveEmailAction,
            completeTask: firstCompleteTask,
        })
        const secondRequest = completeEmailLinkedTask({
            archiveEmail: true,
            archiveData: { ...archiveData, messageIds: ['message-1', 'message-1'] },
            archiveEmailAction,
            completeTask: secondCompleteTask,
        })

        expect(archiveEmailAction).toHaveBeenCalledTimes(1)
        expect(firstRequest).toBe(secondRequest)
        expect(firstCompleteTask).toHaveBeenCalledTimes(1)
        expect(secondCompleteTask).toHaveBeenCalledTimes(1)

        finishArchive()
        await firstRequest
    })
})
