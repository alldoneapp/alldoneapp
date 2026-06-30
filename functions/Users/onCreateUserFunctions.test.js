const mockCreateUserRecord = jest.fn()
const mockSendEmailToNewSignUpUser = jest.fn()
const mockInProductionEnvironment = jest.fn()
const mockSyncHeartbeatSchedulesForUser = jest.fn()

jest.mock('firebase-admin', () => ({}))

jest.mock('../AlgoliaGlobalSearchHelper', () => ({
    createUserRecord: mockCreateUserRecord,
}))

jest.mock('../SendInBlueManager', () => ({
    sendEmailToNewSignUpUser: mockSendEmailToNewSignUpUser,
}))

jest.mock('../Utils/HelperFunctionsCloud', () => ({
    inProductionEnvironment: mockInProductionEnvironment,
}))

jest.mock('../Assistant/assistantHeartbeatSchedule', () => ({
    safelySyncHeartbeatSchedules: operation => operation(),
    syncHeartbeatSchedulesForUser: mockSyncHeartbeatSchedulesForUser,
}))

const { onCreateUser } = require('./onCreateUserFunctions')

describe('onCreateUser', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockInProductionEnvironment.mockReturnValue(true)
        mockCreateUserRecord.mockResolvedValue()
        mockSendEmailToNewSignUpUser.mockResolvedValue()
        mockSyncHeartbeatSchedulesForUser.mockResolvedValue()
    })

    test('runs signup side effects for a valid user document', async () => {
        const user = { uid: 'user-1', displayName: 'Ada', email: 'ada@example.com' }

        await onCreateUser(user)

        expect(mockSendEmailToNewSignUpUser).toHaveBeenCalledWith(expect.any(Object), user)
        expect(mockCreateUserRecord).toHaveBeenCalledWith('user-1', user)
        expect(mockSyncHeartbeatSchedulesForUser).toHaveBeenCalledWith('user-1')
    })

    test.each([undefined, null, '', '   '])('ignores documents without a valid email: %p', async email => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

        await onCreateUser({ uid: 'assistant-1', email })

        expect(mockSendEmailToNewSignUpUser).not.toHaveBeenCalled()
        expect(mockCreateUserRecord).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledWith('Skipping user creation side effects for document without a valid email', {
            userId: 'assistant-1',
        })
        warn.mockRestore()
    })
})
