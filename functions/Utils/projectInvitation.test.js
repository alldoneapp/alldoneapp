const mockSend = jest.fn(async () => null)
let mockProduction = true

jest.mock('firebase-admin', () => ({ firestore: jest.fn() }))
jest.mock('../SendInBlueManager', () => ({ sendEmailInvitationToProject: mockSend }))
jest.mock('../firebaseConfig.js', () => ({ app_url: 'https://my.alldone.app/' }))
jest.mock('../Users/usersFirestore', () => ({
    getUserData: jest.fn(async uid => ({ uid, displayName: `${uid} Person`, photoURL: '' })),
}))
jest.mock('./HelperFunctionsCloud', () => ({ inProductionEnvironment: () => mockProduction }))

const {
    onCreateProjectInvitation,
    buildInvitationAnswerUrl,
    MAX_INVITATION_EMAILS_PER_INVITER_PER_DAY,
} = require('./projectInvitation')

const createDb = (docs = {}) => {
    const store = { ...docs }
    const db = {
        doc: path => ({
            path,
            get: async () => ({ exists: path in store, data: () => store[path] }),
        }),
        runTransaction: async callback =>
            callback({
                get: async ref => ({ exists: ref.path in store, data: () => store[ref.path] }),
                set: (ref, data) => {
                    store[ref.path] = { ...(store[ref.path] || {}), ...data }
                },
            }),
    }
    return { db, store }
}

const project = { name: 'Roadmap', color: '#fff', userIds: ['inviter'] }

describe('project invitation mail (security audit 2026-11, NV-27)', () => {
    beforeEach(() => {
        mockSend.mockClear()
        mockProduction = true
    })

    it('builds the answer link itself and ignores the url stored on the invitation', async () => {
        const { db } = createDb({ 'projects/p1': project })
        await onCreateProjectInvitation(
            { userEmail: 'guest@example.com', inviterId: 'inviter', url: 'https://phish.example/login' },
            'p1',
            { db, now: 0 }
        )
        expect(mockSend).toHaveBeenCalledTimes(1)
        expect(mockSend.mock.calls[0][0]).toMatchObject({
            userEmail: 'guest@example.com',
            inviterName: 'inviter',
            answerURL: 'https://my.alldone.app/projects/p1/contacts/guest@example.com/add',
        })
    })

    it('sends nothing for an inviter who is not a member of the project', async () => {
        const { db } = createDb({ 'projects/p1': project })
        await onCreateProjectInvitation({ userEmail: 'guest@example.com', inviterId: 'victim' }, 'p1', { db })
        expect(mockSend).not.toHaveBeenCalled()
    })

    it('refuses an address that could break out of the link', () => {
        expect(buildInvitationAnswerUrl('https://my.alldone.app/', 'p1', 'a@b.c/../../x')).toBe('')
        expect(buildInvitationAnswerUrl('https://my.alldone.app/', 'p1', 'a@b.c"><script>')).toBe('')
        expect(buildInvitationAnswerUrl('https://my.alldone.app/', 'p/1', 'a@b.co')).toBe('')
        expect(buildInvitationAnswerUrl('https://my.alldone.app', 'p1', 'a+b@b.co')).toBe(
            'https://my.alldone.app/projects/p1/contacts/a+b@b.co/add'
        )
    })

    it('limits how many invitation mails one inviter can send per day', async () => {
        const { db } = createDb({ 'projects/p1': project })
        for (let i = 0; i < MAX_INVITATION_EMAILS_PER_INVITER_PER_DAY + 3; i++) {
            await onCreateProjectInvitation({ userEmail: `g${i}@example.com`, inviterId: 'inviter' }, 'p1', {
                db,
                now: 1_000,
            })
        }
        expect(mockSend).toHaveBeenCalledTimes(MAX_INVITATION_EMAILS_PER_INVITER_PER_DAY)

        await onCreateProjectInvitation({ userEmail: 'next@example.com', inviterId: 'inviter' }, 'p1', {
            db,
            now: 1_000 + 24 * 60 * 60 * 1000,
        })
        expect(mockSend).toHaveBeenCalledTimes(MAX_INVITATION_EMAILS_PER_INVITER_PER_DAY + 1)
    })

    it('sends nothing outside production', async () => {
        mockProduction = false
        const { db } = createDb({ 'projects/p1': project })
        await onCreateProjectInvitation({ userEmail: 'guest@example.com', inviterId: 'inviter' }, 'p1', { db })
        expect(mockSend).not.toHaveBeenCalled()
    })
})
