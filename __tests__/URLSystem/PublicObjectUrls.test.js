/**
 * @jest-environment jsdom
 */

import { getNoteMeta, getProjectData, loginWithGoogleWebAnonymously } from '../../utils/backends/firestore'
import { getUserData } from '../../utils/backends/Users/usersFirestore'
import { getGoalData } from '../../utils/backends/Goals/goalsFirestore'
import { getSkillData } from '../../utils/backends/Skills/skillsFirestore'
import { getChatMeta } from '../../utils/backends/Chats/chatsFirestore'
import { getAssistantData } from '../../utils/backends/Assistants/assistantsFirestore'
import { getContactData } from '../../utils/backends/Contacts/contactsFirestore'
import SharedHelper from '../../utils/SharedHelper'
import TasksHelper from '../../components/TaskListView/Utils/TasksHelper'
import ChatHelper from '../../components/ChatsView/Utils/ChatHelper'
import Backend from '../../utils/BackendBridge'
import store from '../../redux/store'
import { storeCurrentUser } from '../../redux/actions'
import { seedLoggedUser, seedProjects } from '../../testUtils/seedStore'
import {
    DV_TAB_CHAT_BOARD,
    DV_TAB_GOAL_CHAT,
    DV_TAB_NOTE_EDITOR,
    DV_TAB_SKILL_CHAT,
} from '../../utils/TabNavigationConstants'

jest.mock('../../utils/backends/firestore', () => ({
    ...jest.createMockFromModule('../../utils/backends/firestore'),
    getNotesCollaborationServerData: () => ({ NOTES_COLLABORATION_SERVER: 'ws://localhost:1234' }),
    getProjectData: jest.fn(),
    getNoteMeta: jest.fn(),
    loginWithGoogleWebAnonymously: jest.fn(),
}))
jest.mock('../../utils/backends/Users/usersFirestore', () => ({
    ...jest.createMockFromModule('../../utils/backends/Users/usersFirestore'),
    getUserData: jest.fn(),
}))
jest.mock('../../utils/backends/Goals/goalsFirestore', () => ({
    ...jest.createMockFromModule('../../utils/backends/Goals/goalsFirestore'),
    getGoalData: jest.fn(),
}))
jest.mock('../../utils/backends/Skills/skillsFirestore', () => ({
    ...jest.createMockFromModule('../../utils/backends/Skills/skillsFirestore'),
    getSkillData: jest.fn(),
}))
jest.mock('../../utils/backends/Chats/chatsFirestore', () => ({
    ...jest.createMockFromModule('../../utils/backends/Chats/chatsFirestore'),
    getChatMeta: jest.fn(),
}))
jest.mock('../../utils/backends/Assistants/assistantsFirestore', () => ({
    ...jest.createMockFromModule('../../utils/backends/Assistants/assistantsFirestore'),
    getAssistantData: jest.fn(),
}))
jest.mock('../../utils/backends/Contacts/contactsFirestore', () => ({
    ...jest.createMockFromModule('../../utils/backends/Contacts/contactsFirestore'),
    getContactData: jest.fn(),
}))

const PROJECT_ID = 'public-project'
const PUBLIC_PROJECT = {
    id: PROJECT_ID,
    creatorId: 'project-creator',
    userIds: ['project-creator'],
    globalAssistantIds: [],
    isShared: 0,
}

const openAnonymously = async path => {
    const onIsShared = jest.fn()
    const onNotShared = jest.fn()
    await SharedHelper.processUrl(false, path, jest.fn(), onIsShared, onNotShared, jest.fn(), jest.fn())
    return { onIsShared, onNotShared }
}

describe('anonymous public object links', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        loginWithGoogleWebAnonymously.mockResolvedValue()
        getProjectData.mockResolvedValue(PUBLIC_PROJECT)
        getGoalData.mockResolvedValue({ id: 'goal-1', creatorId: 'goal-creator', isPublicFor: [0] })
        getSkillData.mockResolvedValue({ id: 'skill-1', userId: 'skill-owner', isPublicFor: [0] })
        getChatMeta.mockResolvedValue({ id: 'chat-1', creatorId: 'chat-creator', isPublicFor: [0] })
        getAssistantData.mockResolvedValue({ id: 'assistant-1', creatorId: 'assistant-creator' })
        getContactData.mockResolvedValue({ id: 'contact-1', recorderUserId: 'contact-recorder', isPublicFor: [0] })
    })

    it.each([
        ['goal chat', `/projects/${PROJECT_ID}/goals/goal-1/chat`, 'goal-creator'],
        ['skill chat', `/projects/${PROJECT_ID}/skills/skill-1/chat`, 'skill-owner'],
        ['standalone chat', `/projects/${PROJECT_ID}/chats/chat-1/chat`, 'chat-creator'],
        ['assistant', `/projects/${PROJECT_ID}/assistants/assistant-1/chat`, 'assistant-creator'],
        ['project', `/project/${PROJECT_ID}/properties`, 'project-creator'],
        ['contact chat', `/projects/${PROJECT_ID}/contacts/contact-1/chat`, 'contact-recorder'],
    ])('opens a public %s without reading its owner private profile', async (_, path, ownerId) => {
        expect(SharedHelper.matchesSharedResourceUrl(path)).toBe(true)
        const { onIsShared, onNotShared } = await openAnonymously(path)

        expect(getUserData).not.toHaveBeenCalled()
        expect(onIsShared).toHaveBeenCalledWith(
            path,
            {
                projectUser: expect.objectContaining({ uid: ownerId }),
                currentUser: expect.objectContaining({ uid: ownerId }),
            },
            expect.objectContaining({ projectId: PROJECT_ID }),
            expect.any(String)
        )
        expect(onNotShared).not.toHaveBeenCalled()
    })

    it('keeps private contacts inaccessible', async () => {
        getContactData.mockResolvedValue({ id: 'contact-1', isPublicFor: ['contact-recorder'] })
        const { onIsShared, onNotShared } = await openAnonymously(`/projects/${PROJECT_ID}/contacts/contact-1/chat`)

        expect(onIsShared).not.toHaveBeenCalled()
        expect(onNotShared).toHaveBeenCalledTimes(1)
        expect(getUserData).not.toHaveBeenCalled()
    })

    it('treats a denied contact lookup as a private resource', async () => {
        getContactData.mockRejectedValue({ code: 'permission-denied' })
        const { onIsShared, onNotShared } = await openAnonymously(`/projects/${PROJECT_ID}/contacts/contact-1/chat`)

        expect(onIsShared).not.toHaveBeenCalled()
        expect(onNotShared).toHaveBeenCalledTimes(1)
        expect(getUserData).not.toHaveBeenCalled()
    })

    it('does not expose a project member private profile as a public contact', async () => {
        const { onIsShared, onNotShared } = await openAnonymously(
            `/projects/${PROJECT_ID}/contacts/project-creator/profile`
        )

        expect(onIsShared).not.toHaveBeenCalled()
        expect(onNotShared).toHaveBeenCalledTimes(1)
        expect(getContactData).not.toHaveBeenCalled()
        expect(getUserData).not.toHaveBeenCalled()
    })
})

describe('anonymous public object detail navigation', () => {
    let navigation

    beforeEach(() => {
        jest.clearAllMocks()
        navigation = { navigate: jest.fn() }
        store.dispatch([
            ...seedProjects([PUBLIC_PROJECT]),
            seedLoggedUser({
                uid: PUBLIC_PROJECT.creatorId,
                projectIds: [PROJECT_ID],
                isAnonymous: true,
            }),
            storeCurrentUser({ uid: PUBLIC_PROJECT.creatorId }),
        ])
        getGoalData.mockResolvedValue({ id: 'goal-1', creatorId: 'goal-creator', isPublicFor: [0] })
        getSkillData.mockResolvedValue({ id: 'skill-1', userId: 'skill-owner', isPublicFor: [0] })
        getChatMeta.mockResolvedValue({ id: 'chat-1', creatorId: 'chat-creator', isPublicFor: [0] })
        getNoteMeta.mockResolvedValue({ id: 'note-1', userId: 'note-owner', isPublicFor: [0] })
    })

    it('opens goal and skill chats without resolving private owner profiles', async () => {
        const userLookup = jest.spyOn(Backend, 'getUserDataByUidOrEmail')

        await TasksHelper.processURLGoalDetailsTab(navigation, DV_TAB_GOAL_CHAT, PROJECT_ID, 'goal-1')
        await TasksHelper.processURLSkillDetailsTab(navigation, DV_TAB_SKILL_CHAT, PROJECT_ID, 'skill-1')

        expect(userLookup).not.toHaveBeenCalled()
        expect(navigation.navigate).toHaveBeenCalledWith(
            'GoalDetailedView',
            expect.objectContaining({ projectId: PROJECT_ID, goalId: 'goal-1' })
        )
        expect(navigation.navigate).toHaveBeenCalledWith(
            'SkillDetailedView',
            expect.objectContaining({ projectId: PROJECT_ID, skillId: 'skill-1' })
        )
    })

    it('opens a note without probing its private owner profile', async () => {
        const ownerLookup = jest.spyOn(Backend, 'getUserOrContactBy')

        await TasksHelper.processURLNoteDetailsTab(navigation, DV_TAB_NOTE_EDITOR, PROJECT_ID, 'note-1')

        expect(ownerLookup).not.toHaveBeenCalled()
        expect(navigation.navigate).toHaveBeenCalledWith(
            'NotesDetailedView',
            expect.objectContaining({ projectId: PROJECT_ID, noteId: 'note-1' })
        )
    })

    it('opens a standalone chat without probing its private creator profile', async () => {
        const userLookup = jest.spyOn(Backend, 'getUserDataByUidOrEmail')

        await ChatHelper.processURLChatDetailsTab(navigation, DV_TAB_CHAT_BOARD, PROJECT_ID, 'chat-1')

        expect(userLookup).not.toHaveBeenCalled()
        expect(navigation.navigate).toHaveBeenCalledWith(
            'ChatDetailedView',
            expect.objectContaining({ projectId: PROJECT_ID, chat: expect.objectContaining({ id: 'chat-1' }) })
        )
    })
})
