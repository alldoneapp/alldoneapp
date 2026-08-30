/**
 * AT-2428. The two `users/` lookups that are questions rather than assertions.
 *
 * `getUserOrContactBy` races four collections precisely because the id may belong to any of them,
 * so a miss in `users/` is the ordinary answer for three quarters of its callers. Charging that
 * answer a REST verification round trip and a `console.error` — which is what produced
 * `GET .../users/ZB7uJwP96zwloGUiCkY5 404` followed by `User document not found in Firestore` on
 * an ordinary contact navigation — is noise that hides the real failures next to it.
 *
 * The part that must NOT be lost is the escalation: when nothing explains the absence, the
 * verified read still runs, so a real user whose realtime read was wrong is still recovered and a
 * genuinely missing document is still reported.
 */
const mockGetUserData = jest.fn()
const mockGetUsersByEmail = jest.fn()
const mockGetContactData = jest.fn()
const mockGetAssistantData = jest.fn()
const mockGetWorkstreamData = jest.fn()
const mockIsWorkstream = jest.fn(() => false)

jest.mock('./Users/usersFirestore', () => ({
    getUserData: (...args) => mockGetUserData(...args),
    getUsersByEmail: (...args) => mockGetUsersByEmail(...args),
}))
jest.mock('./Contacts/contactsFirestore', () => ({
    getContactData: (...args) => mockGetContactData(...args),
}))
jest.mock('./Assistants/assistantsFirestore', () => ({
    getAssistantData: (...args) => mockGetAssistantData(...args),
}))
jest.mock('./Workstreams/workstreamsFirestore', () => ({
    getWorkstreamData: (...args) => mockGetWorkstreamData(...args),
}))
jest.mock('../../components/Workstreams/WorkstreamHelper', () => ({
    isWorkstream: (...args) => mockIsWorkstream(...args),
    DEFAULT_WORKSTREAM_ID: 'ws-default',
}))

const { getUserDataByUidOrEmail, getUserOrContactBy } = require('./firestore')

const PROBE = { absenceIsExpected: true }

beforeEach(() => {
    mockGetUserData.mockReset()
    mockGetUsersByEmail.mockReset()
    mockGetContactData.mockReset()
    mockGetAssistantData.mockReset()
    mockGetWorkstreamData.mockReset()
    mockIsWorkstream.mockReset()
    mockIsWorkstream.mockReturnValue(false)
})

describe('getUserOrContactBy', () => {
    it('probes users/ instead of demanding a verified answer', async () => {
        const user = { uid: 'user-1' }
        mockGetUserData.mockResolvedValue(user)
        mockGetContactData.mockResolvedValue(null)
        mockGetAssistantData.mockResolvedValue(null)

        await expect(getUserOrContactBy('project-1', 'user-1')).resolves.toBe(user)
        expect(mockGetUserData).toHaveBeenCalledWith('user-1', false, PROBE)
        expect(mockGetUserData).toHaveBeenCalledTimes(1)
    })

    it('does not reject a resolved user when the speculative contact probe is denied', async () => {
        const user = { uid: 'user-1' }
        mockGetUserData.mockResolvedValue(user)
        mockGetContactData.mockRejectedValue({ code: 'permission-denied' })
        mockGetAssistantData.mockResolvedValue(null)

        await expect(getUserOrContactBy('project-1', 'user-1')).resolves.toBe(user)
        expect(mockGetUserData).toHaveBeenCalledTimes(1)
    })

    it('does not escalate when a contact explains the missing user document', async () => {
        const contact = { id: 'contact-1' }
        mockGetUserData.mockResolvedValue(null)
        mockGetContactData.mockResolvedValue(contact)
        mockGetAssistantData.mockResolvedValue(null)

        await expect(getUserOrContactBy('project-1', 'contact-1')).resolves.toBe(contact)
        // One cheap read. This is the case that used to cost a 404 and a console ERROR.
        expect(mockGetUserData).toHaveBeenCalledTimes(1)
        expect(mockGetUserData).toHaveBeenCalledWith('contact-1', false, PROBE)
    })

    it('does not escalate when an assistant explains it', async () => {
        const assistant = { uid: 'assistant-1' }
        mockGetUserData.mockResolvedValue(null)
        mockGetContactData.mockResolvedValue(null)
        mockGetAssistantData.mockResolvedValueOnce(assistant).mockResolvedValueOnce(null)

        await expect(getUserOrContactBy('project-1', 'assistant-1')).resolves.toBe(assistant)
        expect(mockGetUserData).toHaveBeenCalledTimes(1)
    })

    it('escalates to the verified read when nothing explains the absence', async () => {
        mockGetUserData.mockResolvedValue(null)
        mockGetContactData.mockResolvedValue(null)
        mockGetAssistantData.mockResolvedValue(null)

        await expect(getUserOrContactBy('project-1', 'ZB7uJwP96zwloGUiCkY5')).resolves.toBe(null)
        expect(mockGetUserData).toHaveBeenCalledTimes(2)
        // No options on the escalation: the loud, server-verified read.
        expect(mockGetUserData).toHaveBeenLastCalledWith('ZB7uJwP96zwloGUiCkY5', false)
    })

    it('returns the user the verified read recovers after the probe missed it', async () => {
        const recovered = { uid: 'flaky-user' }
        mockGetUserData.mockResolvedValueOnce(null).mockResolvedValueOnce(recovered)
        mockGetContactData.mockResolvedValue(null)
        mockGetAssistantData.mockResolvedValue(null)

        await expect(getUserOrContactBy('project-1', 'flaky-user')).resolves.toBe(recovered)
    })

    it('still surfaces an unexpected candidate failure when no lookup resolves', async () => {
        const backendError = { code: 'unavailable' }
        mockGetUserData.mockResolvedValue(null)
        mockGetContactData.mockRejectedValue(backendError)
        mockGetAssistantData.mockResolvedValue(null)

        await expect(getUserOrContactBy('project-1', 'unavailable-owner')).rejects.toBe(backendError)
        expect(mockGetUserData).toHaveBeenCalledTimes(1)
    })

    it('still short-circuits a workstream id without touching users/', async () => {
        const workstream = { id: 'ws-1' }
        mockIsWorkstream.mockReturnValue(true)
        mockGetWorkstreamData.mockResolvedValue(workstream)

        await expect(getUserOrContactBy('project-1', 'ws-1')).resolves.toBe(workstream)
        expect(mockGetUserData).not.toHaveBeenCalled()
    })
})

describe('getUserDataByUidOrEmail', () => {
    it('passes the probe option through to the user read', async () => {
        mockGetUserData.mockResolvedValue(null)

        await getUserDataByUidOrEmail('some-id', PROBE)

        expect(mockGetUserData).toHaveBeenCalledWith('some-id', false, PROBE)
    })

    it('keeps the verified read when no options are given', async () => {
        mockGetUserData.mockResolvedValue(null)

        await getUserDataByUidOrEmail('some-id')

        expect(mockGetUserData).toHaveBeenCalledWith('some-id', false, undefined)
    })

    it('returns null for an email with no account instead of throwing', async () => {
        // The project-invitation path invites people who have not signed up yet, and every caller
        // already branches on `user != null`. Dereferencing the empty query result threw
        // `Cannot read properties of undefined (reading 'id')` and took the flow down with it.
        mockGetUsersByEmail.mockResolvedValue([])

        await expect(getUserDataByUidOrEmail('nobody@example.com')).resolves.toBe(null)
        expect(mockGetUserData).not.toHaveBeenCalled()
    })

    it('still maps a registered email to its user', async () => {
        mockGetUsersByEmail.mockResolvedValue([{ id: 'user-9', data: () => ({ email: 'karsten@example.com' }) }])

        const user = await getUserDataByUidOrEmail('karsten@example.com')

        expect(user).toMatchObject({ uid: 'user-9', email: 'karsten@example.com' })
    })
})
