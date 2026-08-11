const mockSendNotificationWithTemplate = jest.fn()
const mockRemoveSingleChatNotification = jest.fn(async () => {})
const mockGetUserData = jest.fn()

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({})),
    messaging: jest.fn(() => ({
        sendEachForMulticast: jest.fn(async () => ({ responses: [], failureCount: 0 })),
    })),
}))

jest.mock(
    'firebase-functions/params',
    () => ({
        defineString: jest.fn(() => ({ value: jest.fn(() => '') })),
    }),
    { virtual: true }
)

jest.mock('../Users/usersFirestore', () => ({
    removeUserFcmTokens: jest.fn(),
    getUserData: (...args) => mockGetUserData(...args),
}))

jest.mock('../Chats/chatsFirestoreCloud', () => ({
    getChatPushNotifications: jest.fn(),
    removeChatPushNotifications: jest.fn(),
    removeSingleChatNotification: (...args) => mockRemoveSingleChatNotification(...args),
}))

jest.mock('../BatchWrapper/batchWrapper', () => ({
    BatchWrapper: jest.fn().mockImplementation(() => ({
        update: jest.fn(),
        set: jest.fn(),
        delete: jest.fn(),
        commit: jest.fn(async () => {}),
    })),
}))

jest.mock('../Services/TwilioWhatsAppService', () =>
    jest.fn().mockImplementation(() => ({
        sendNotificationWithTemplate: (...args) => mockSendNotificationWithTemplate(...args),
    }))
)

const { processPushNotifications } = require('./pushNotifications')

describe('pushNotifications WhatsApp auto-read', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockGetUserData.mockResolvedValue({
            uid: 'user-1',
            receiveWhatsApp: true,
            phone: '+1234567890',
            pushNotificationsStatus: false,
            fcmToken: [],
        })
    })

    test('marks unread chat notification as read after successful WhatsApp delivery', async () => {
        mockSendNotificationWithTemplate.mockResolvedValue({ success: true })

        await processPushNotifications([
            {
                id: 'comment-1',
                userIds: ['user-1'],
                body: 'Project A\n✔ Topic A\nAssistant commented: Reply sent',
                link: 'https://my.alldone.app/projects/project-1/chats/chat-1/chat',
                chatId: 'chat-1',
                projectId: 'project-1',
            },
        ])

        expect(mockSendNotificationWithTemplate).toHaveBeenCalledWith(
            '+1234567890',
            'user-1',
            'Project A',
            'Topic A',
            'Reply sent',
            'https://my.alldone.app/projects/project-1/chats/chat-1/chat'
        )
        expect(mockRemoveSingleChatNotification).toHaveBeenCalledWith('project-1', 'user-1', 'comment-1')
    })

    test('leaves unread chat notification when WhatsApp delivery fails', async () => {
        mockSendNotificationWithTemplate.mockRejectedValue(new Error('Twilio failed'))

        await processPushNotifications([
            {
                id: 'comment-2',
                userIds: ['user-1'],
                body: 'Project A\n✔ Topic A\nAssistant commented: Reply sent',
                link: 'https://my.alldone.app/projects/project-1/chats/chat-1/chat',
                chatId: 'chat-1',
                projectId: 'project-1',
            },
        ])

        expect(mockRemoveSingleChatNotification).not.toHaveBeenCalled()
    })
})
