'use strict'

// Security audit 2026-11 (#11): an emailNotifications document names its recipients, and the list
// it is built from is member-writable and outlives membership. Only current members are mailed.

const mockGetUserDocs = jest.fn(async (admin, userIds) =>
    userIds.map(uid => ({ data: () => ({ uid, receiveEmails: true, email: `${uid}@example.com` }) }))
)
const mockSendEmail = jest.fn()
jest.mock('./Emails/NewChatMessage/sendChatNoitifcationsHelper', () => ({
    generateEmailContent: jest.fn(() => '<html></html>'),
    sendEmailWithSendInBlue: (...args) => mockSendEmail(...args),
    getUserDocs: (...args) => mockGetUserDocs(...args),
    getProject: jest.fn(async () => ({ name: 'Product', color: '#ffffff', userIds: ['member-1', 'member-2'] })),
}))
jest.mock('./firebaseConfig.js', () => ({}))
jest.mock('./Users/usersFirestore', () => ({ getUserData: jest.fn() }))
jest.mock('./envFunctionsHelper', () => ({ getEnvFunctions: () => ({ SIB_API_KEY: 'test' }) }))

const { sendChatNotifications } = require('./SendInBlueManager')

test('mails a chat notification only to current members of the project', async () => {
    const deleted = []
    const admin = {
        firestore: () => ({
            collection: () => ({
                get: async () => ({
                    docs: [
                        {
                            id: 'task-1',
                            data: () => ({
                                userIds: ['member-1', 'removed-member', 'member-2', 'stranger'],
                                projectId: 'project-1',
                                objectType: 'tasks',
                                objectId: 'task-1',
                                objectName: 'Launch',
                                messageTimestamp: 1,
                            }),
                        },
                    ],
                }),
            }),
            doc: path => ({ delete: async () => deleted.push(path) }),
        }),
    }

    await sendChatNotifications(admin)

    expect(mockGetUserDocs).toHaveBeenCalledWith(admin, ['member-1', 'member-2'])
    expect(mockSendEmail.mock.calls.map(call => call[2]).sort()).toEqual([
        'member-1@example.com',
        'member-2@example.com',
    ])
    expect(deleted).toEqual(['emailNotifications/task-1'])
})
