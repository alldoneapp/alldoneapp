import { completeEmailLinkedTask } from './emailTaskCompletion'

describe('completeEmailLinkedTask', () => {
    const archiveData = { connectionProjectId: 'connection-1', messageIds: ['message-1'] }

    test('archives the linked email before completing the task', async () => {
        const events = []
        const archiveEmailAction = jest.fn().mockImplementation(async () => events.push('archive'))
        const completeTask = jest.fn(() => events.push('complete'))

        await completeEmailLinkedTask({ archiveEmail: true, archiveData, archiveEmailAction, completeTask })

        expect(archiveEmailAction).toHaveBeenCalledWith('connection-1', {
            action: 'archive',
            messageIds: ['message-1'],
        })
        expect(completeTask).toHaveBeenCalledTimes(1)
        expect(events).toEqual(['archive', 'complete'])
    })

    test('completes the task without changing the linked email', async () => {
        const archiveEmailAction = jest.fn()
        const completeTask = jest.fn()

        await completeEmailLinkedTask({ archiveEmail: false, archiveData, archiveEmailAction, completeTask })

        expect(archiveEmailAction).not.toHaveBeenCalled()
        expect(completeTask).toHaveBeenCalledTimes(1)
    })

    test('does not complete the task when archiving fails', async () => {
        const error = new Error('provider unavailable')
        const archiveEmailAction = jest.fn().mockRejectedValue(error)
        const completeTask = jest.fn()

        await expect(
            completeEmailLinkedTask({ archiveEmail: true, archiveData, archiveEmailAction, completeTask })
        ).rejects.toBe(error)
        expect(completeTask).not.toHaveBeenCalled()
    })
})
