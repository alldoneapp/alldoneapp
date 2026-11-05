/**
 * PT-5425: the one app-wide slot a failed background dictation puts its draft into.
 */
import {
    closeDictationTaskRecovery,
    getDictationTaskRecovery,
    openDictationTaskRecovery,
    subscribeDictationTaskRecovery,
} from './dictationTaskRecovery'

afterEach(() => closeDictationTaskRecovery())

test('opens, notifies and closes', () => {
    const listener = jest.fn()
    const unsubscribe = subscribeDictationTaskRecovery(listener)

    const id = openDictationTaskRecovery({ projectId: 'p', task: { name: 'x' } })
    expect(getDictationTaskRecovery()).toMatchObject({ id, projectId: 'p', automaticProject: false })
    expect(listener).toHaveBeenCalledTimes(1)

    closeDictationTaskRecovery(id)
    expect(getDictationTaskRecovery()).toBeNull()
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
})

test('closing an older recovery never dismisses a newer one', () => {
    const older = openDictationTaskRecovery({ projectId: 'p', task: { name: 'old' } })
    const newer = openDictationTaskRecovery({ projectId: 'p', task: { name: 'new' } })

    closeDictationTaskRecovery(older)
    expect(getDictationTaskRecovery()).toMatchObject({ id: newer, task: { name: 'new' } })
})
