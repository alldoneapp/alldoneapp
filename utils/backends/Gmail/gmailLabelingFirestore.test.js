import { watchGmailLabelingConfigs } from './gmailLabelingFirestore'
import { getDb } from '../firestore'

jest.mock('../firestore', () => ({ getDb: jest.fn() }))

test('subscribes only to the user labeling configs and forwards data, errors and cleanup', () => {
    const unsubscribe = jest.fn()
    let next, error
    const onSnapshot = jest.fn((onNext, onError) => {
        next = onNext
        error = onError
        return unsubscribe
    })
    const where = jest.fn(() => ({ onSnapshot }))
    const collection = jest.fn(() => ({ where }))
    getDb.mockReturnValue({ collection })
    const onChange = jest.fn()
    const onError = jest.fn()

    expect(watchGmailLabelingConfigs('user1', onChange, onError)).toBe(unsubscribe)
    expect(collection).toHaveBeenCalledWith('users/user1/private')
    expect(where).toHaveBeenCalledWith('type', '==', 'gmailLabelingConfig')
    const config = { enabled: true, syncIntervalMinutes: 60 }
    next({ forEach: fn => fn({ id: 'gmailLabeling_project1', data: () => config }) })
    expect(onChange).toHaveBeenCalledWith({ gmailLabeling_project1: config })
    const failure = new Error('offline')
    error(failure)
    expect(onError).toHaveBeenCalledWith(failure)
})
