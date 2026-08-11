import React from 'react'
import renderer, { act } from 'react-test-renderer'

import CommentPopupObjectHeader from './CommentPopupObjectHeader'
import { getParentObjectData } from '../../../../utils/backends/Chats/chatsComments'
import { unwatch } from '../../../../utils/backends/firestore'

jest.mock('react-redux', () => ({
    useSelector: selector => selector({ loggedUserProjects: [{ id: 'project-1' }] }),
}))
jest.mock('uuid/v4', () => () => 'watcher-1')
jest.mock('../../../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../../../utils/backends/Chats/chatsComments', () => ({ getParentObjectData: jest.fn() }))
jest.mock('../../../../utils/backends/Tasks/tasksFirestore', () => ({ watchTask: jest.fn() }))
jest.mock('../../../../utils/backends/Goals/goalsFirestore', () => ({ watchGoal: jest.fn() }))
jest.mock('../../../../utils/backends/Skills/skillsFirestore', () => ({ watchSkill: jest.fn() }))
jest.mock('../../../../utils/backends/Chats/chatsFirestore', () => ({ watchChat: jest.fn() }))
jest.mock('../../../../utils/backends/Contacts/contactsFirestore', () => ({ watchContactData: jest.fn() }))
jest.mock('../../../../utils/backends/firestore', () => ({
    unwatch: jest.fn(),
    unwatchNote: jest.fn(),
    watchNote: jest.fn(),
    watchUserData: jest.fn(),
}))
jest.mock('../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getProjectById: () => ({ id: 'project-1', color: 'blue' }),
}))
jest.mock('../../../TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    default: { getUserInProject: () => null },
}))
jest.mock('../../../TaskListView/TaskItem/TaskPresentation/TaskPresentation', () => 'TaskPresentation')
jest.mock('../../../GoalsView/GoalItemPresentation', () => 'GoalItemPresentation')
jest.mock('../../../ContactsView/ContactItem', () => 'ContactItem')
jest.mock('../../../NotesView/NotesItem', () => 'NotesItem')
jest.mock('../../../ChatsView/ChatItem', () => 'ChatItem')
jest.mock('../../../SettingsView/Profile/Skills/SkillItem/SkillPresentation', () => 'SkillPresentation')
jest.mock('../../../AdminPanel/Assistants/AssistantPresentation', () => 'AssistantPresentation')
jest.mock('./Header', () => 'Header')

const PRESENTATION_BY_TYPE = {
    tasks: 'TaskPresentation',
    goals: 'GoalItemPresentation',
    contacts: 'ContactItem',
    users: 'ContactItem',
    notes: 'NotesItem',
    topics: 'ChatItem',
    skills: 'SkillPresentation',
    assistants: 'AssistantPresentation',
}

const OPEN_PROP_BY_TYPE = {
    tasks: 'toggleModal',
    goals: 'onPress',
    contacts: 'onPress',
    users: 'onPress',
    notes: 'onPress',
    topics: 'onPress',
    skills: 'onPress',
    assistants: 'onAssistantClick',
}

const renderHeader = async (
    objectType,
    object = { id: 'object-1', uid: 'object-1' },
    onOpen,
    onWorkflowTransitionSuccess
) => {
    getParentObjectData.mockResolvedValue({ object })
    let tree
    await act(async () => {
        tree = renderer.create(
            <CommentPopupObjectHeader
                projectId="project-1"
                objectId="object-1"
                objectType={objectType}
                objectName="Fallback title"
                onOpen={onOpen}
                onWorkflowTransitionSuccess={onWorkflowTransitionSuccess}
            />
        )
        await Promise.resolve()
    })
    return tree
}

describe('CommentPopupObjectHeader', () => {
    beforeEach(() => jest.clearAllMocks())

    test.each(Object.entries(PRESENTATION_BY_TYPE))('renders the full %s list presentation', async (type, rowType) => {
        const tree = await renderHeader(type)
        const row = tree.root.findByType(rowType)

        expect(row.props.inCommentPopup).toBe(true)
    })

    test.each(Object.entries(PRESENTATION_BY_TYPE))('opens the %s chat from its main row', async (type, rowType) => {
        const onOpen = jest.fn()
        const tree = await renderHeader(type, { id: 'object-1', uid: 'object-1' }, onOpen)
        const row = tree.root.findByType(rowType)

        row.props[OPEN_PROP_BY_TYPE[type]]()

        expect(onOpen).toHaveBeenCalledTimes(1)
    })

    it('stops embedded row events from reaching popup parent click handlers', async () => {
        const tree = await renderHeader('tasks')
        const boundary = tree.root.find(node => node.props['data-testid'] === 'comment-popup-object-tasks')
        const surface = tree.root.findByProps({ testID: 'comment-popup-object-surface-tasks' })
        const event = { stopPropagation: jest.fn() }

        expect(boundary.props.style).toEqual({ width: '100%' })
        expect(surface.props.style).toEqual(expect.arrayContaining([{ backgroundColor: '#1A3289' }]))

        boundary.props.onClick(event)

        expect(event.stopPropagation).toHaveBeenCalledTimes(1)
    })

    it('passes the popup close callback to task workflow controls', async () => {
        const onWorkflowTransitionSuccess = jest.fn()
        const tree = await renderHeader(
            'tasks',
            { id: 'object-1', uid: 'object-1' },
            undefined,
            onWorkflowTransitionSuccess
        )

        expect(tree.root.findByType('TaskPresentation').props.onCommentPopupWorkflowTransitionSuccess).toBe(
            onWorkflowTransitionSuccess
        )
    })

    it('uses the same dark popup background for non-task objects', async () => {
        const tree = await renderHeader('topics')
        const surface = tree.root.findByProps({ testID: 'comment-popup-object-surface-topics' })

        expect(surface.props.style).toEqual(expect.arrayContaining([{ backgroundColor: '#1A3289' }]))
    })

    it('shows a graceful fallback for deleted objects', async () => {
        const tree = await renderHeader('tasks', null)

        expect(tree.root.findByProps({ accessibilityLabel: 'Object unavailable' })).toBeTruthy()
        expect(tree.root.findByType('Header').props.title).toBe('Fallback title')
    })

    it('removes live object watchers when the popup unmounts', async () => {
        const tree = await renderHeader('tasks')

        act(() => tree.unmount())

        expect(unwatch).toHaveBeenCalledWith('comment-popup-object-watcher-1')
    })
})
