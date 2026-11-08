// A user who opens a template link is not a member of the template or of any of its guides yet, so
// the browser can write none of the membership itself (firestore.rules): which guide, and who
// joins it, comes from joinProjectSecondGen. These pin that the guide flow asks the server first
// and only then writes, as a member, what it always wrote.

const mockState = {
    loggedUser: { uid: 'joiner', language: 'en', preferredTimezone: 'Europe/Berlin', displayName: 'Jo Iner' },
    administratorUser: { uid: 'admin' },
    defaultAssistant: { uid: 'default-assistant' },
}

jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: { getState: () => mockState, dispatch: jest.fn() },
}))
jest.mock('../firestore', () => ({
    createGuideCreatedFeedChain: jest.fn(async () => {}),
    getDb: jest.fn(),
    getProjectData: jest.fn(),
    runHttpsCallableFunction: jest.fn(async () => ({})),
    getId: jest.fn(() => 'chat-id'),
    addFollowerWithoutFeeds: jest.fn(),
}))
jest.mock('../Users/usersFirestore', () => ({
    createProjectJoinFeeds: jest.fn(async () => {}),
    getUserData: jest.fn(async uid => ({ uid, displayName: uid })),
    joinProjectOnServer: jest.fn(),
    loadJoinedProjectIntoStore: jest.fn(async () => {}),
}))
jest.mock('../Chats/chatsComments', () => ({ createChat: jest.fn(async () => {}), addFollowerToChat: jest.fn() }))
jest.mock('../Chats/chatsFirestore', () => ({ getChatMeta: jest.fn(async () => ({ id: 'guideMainChatId' })) }))
jest.mock('../../analytics/analytics', () => ({ trackEvent: jest.fn() }))
jest.mock('../../../i18n/TranslationService', () => ({ setLanguage: jest.fn(), translate: text => text }))
jest.mock('../../HelperFunctions', () => ({ __esModule: true, default: { getFirstName: name => name } }))
jest.mock('../../../components/Feeds/Utils/HelperFunctions', () => ({ MENTION_SPACE_CODE: 'M', STAYWARD_COMMENT: 1 }))
jest.mock('../../../components/Feeds/Utils/FeedsConstants', () => ({ FEED_PUBLIC_FOR_ALL: 0 }))

const { addUserToTemplate } = require('./guidesFirestore')
const firestore = require('../firestore')
const usersFirestore = require('../Users/usersFirestore')
const { getChatMeta } = require('../Chats/chatsFirestore')

const template = {
    id: 'template',
    name: 'Course',
    isTemplate: true,
    templateCreatorId: 'creator',
    userIds: ['creator'],
    guideProjectIds: ['guide-1'],
    globalAssistantIds: [],
}

beforeEach(() => {
    jest.clearAllMocks()
})

describe('addUserToTemplate', () => {
    it('lets the server place the user in a guide before writing anything as a member', async () => {
        usersFirestore.joinProjectOnServer.mockResolvedValue({
            projectId: 'guide-1',
            joinedVia: 'template_guide',
            addedUserIds: ['joiner'],
            previousUserIds: ['creator', 'admin', 'member'],
            isNewGuide: false,
        })
        firestore.getProjectData.mockResolvedValue({ userIds: ['creator', 'admin', 'member', 'joiner'] })

        await addUserToTemplate('joiner', template, false)

        expect(usersFirestore.joinProjectOnServer).toHaveBeenCalledWith('template', {
            startGuide: true,
            timezone: 'Europe/Berlin',
        })
        expect(usersFirestore.joinProjectOnServer.mock.invocationCallOrder[0]).toBeLessThan(
            usersFirestore.createProjectJoinFeeds.mock.invocationCallOrder[0]
        )
        expect(usersFirestore.loadJoinedProjectIntoStore).toHaveBeenCalledWith('guide-1')
        expect(usersFirestore.createProjectJoinFeeds).toHaveBeenCalledTimes(1)
        const [joinedUserId, guideBeforeJoin, guideId, specialFeedUserIds, specialUserIds] =
            usersFirestore.createProjectJoinFeeds.mock.calls[0]
        expect(joinedUserId).toBe('joiner')
        expect(guideBeforeJoin.userIds).toEqual(['creator', 'admin', 'member'])
        expect(guideId).toBe('guide-1')
        expect(specialFeedUserIds).toEqual(['creator', 'admin', 'member', 'joiner'])
        expect(specialUserIds).toBeNull()
        expect(firestore.createGuideCreatedFeedChain).not.toHaveBeenCalled()

        const callables = firestore.runHttpsCallableFunction.mock.calls.map(([name]) => name)
        expect(callables).toEqual(
            expect.arrayContaining([
                'copyTemplateObjectsSecondGen',
                'sendUserJoinsToGuideEmailSecondGen',
                'generateBotWelcomeMessageToUserSecondGen',
            ])
        )
        // The guide already has its team chat, so no second one.
        expect(callables).not.toContain('generateBotWelcomeMessageSecondGen')
    })

    it('writes the created feed and the team chat for a guide the server has just created', async () => {
        getChatMeta.mockResolvedValue(null)
        usersFirestore.joinProjectOnServer.mockResolvedValue({
            projectId: 'guide-2',
            joinedVia: 'template_guide',
            addedUserIds: ['joiner', 'creator', 'admin'],
            previousUserIds: [],
            isNewGuide: true,
        })
        firestore.getProjectData.mockResolvedValue({ name: 'Course 2', userIds: ['joiner', 'creator', 'admin'] })

        await addUserToTemplate('joiner', template, false)

        expect(firestore.createGuideCreatedFeedChain).toHaveBeenCalledWith(expect.objectContaining({ id: 'guide-2' }), [
            'joiner',
            'admin',
            'creator',
        ])
        expect(usersFirestore.createProjectJoinFeeds.mock.calls.map(([uid]) => uid)).toEqual([
            'joiner',
            'creator',
            'admin',
        ])
        expect(usersFirestore.createProjectJoinFeeds.mock.calls[0][4]).toEqual(['joiner', 'admin', 'creator'])
        const copy = firestore.runHttpsCallableFunction.mock.calls.find(
            ([name]) => name === 'copyTemplateObjectsSecondGen'
        )
        expect(copy[1]).toMatchObject({ templateId: 'template', guideId: 'guide-2', isNewGuide: true })
        expect(firestore.runHttpsCallableFunction.mock.calls.map(([name]) => name)).toContain(
            'generateBotWelcomeMessageSecondGen'
        )
    })

    it('does nothing more for a user already in a guide of the template', async () => {
        usersFirestore.joinProjectOnServer.mockResolvedValue({
            projectId: 'guide-1',
            joinedVia: 'member',
            addedUserIds: [],
            previousUserIds: [],
        })

        await addUserToTemplate('joiner', template, false)

        expect(usersFirestore.createProjectJoinFeeds).not.toHaveBeenCalled()
        expect(firestore.runHttpsCallableFunction).not.toHaveBeenCalled()
    })

    it('surfaces a refused join instead of writing to the template', async () => {
        const refused = Object.assign(new Error('Not a template you can join'), { code: 'permission-denied' })
        usersFirestore.joinProjectOnServer.mockRejectedValue(refused)

        await expect(addUserToTemplate('joiner', template, false)).rejects.toBe(refused)
        expect(usersFirestore.createProjectJoinFeeds).not.toHaveBeenCalled()
        expect(firestore.runHttpsCallableFunction).not.toHaveBeenCalled()
    })
})
