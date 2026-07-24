import React from 'react'
import renderer, { act } from 'react-test-renderer'

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector =>
        selector({
            loggedUserProjects: [{ id: 'project-1' }],
            smallScreenNavigation: false,
        }),
}))
jest.mock('react-tiny-popover', () => {
    const React = require('react')
    return ({ children, content, isOpen }) =>
        React.createElement(React.Fragment, null, children, isOpen ? content : null)
})
jest.mock('uuid/v4', () => () => 'checkbox-1')
jest.mock('../../../../i18n/TranslationService', () => ({ translate: text => text }))
jest.mock('../../../../redux/store', () => ({
    getState: () => ({ loggedUser: { uid: 'logged-user' }, openModals: {}, isQuillTagEditorOpen: false }),
}))
jest.mock('../../../../redux/actions', () => ({ setAssignee: jest.fn() }))
jest.mock('../../../../utils/BackendBridge', () => ({ getTaskData: jest.fn() }))
jest.mock('../../../TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    default: { getTaskOwner: jest.fn(), getUserInProject: () => null },
    DONE_STEP: 'done',
    OPEN_STEP: 'open',
    TASK_ASSIGNEE_ASSISTANT_TYPE: 'assistant',
}))
jest.mock('../../../../utils/HelperFunctions', () => ({
    chronoKeysOrder: jest.fn(),
    popoverToSafePosition: jest.fn(),
}))
jest.mock('../../../Feeds/CommentsTextInput/textInputHelper', () => ({
    RECORD_SCREEN_MODAL_ID: 'record-screen',
    RECORD_VIDEO_MODAL_ID: 'record-video',
}))
jest.mock('../../../ModalsManager/modalsManager', () => ({ MENTION_MODAL_ID: 'mention' }))
jest.mock('../../../Workstreams/WorkstreamHelper', () => ({ WORKSTREAM_ID_PREFIX: 'ws_' }))
jest.mock('../../../ContactsView/Utils/ContactsHelper', () => ({ getUserWorkflow: jest.fn() }))
jest.mock('../../../Premium/PremiumHelper', () => ({ checkIsLimitedByXp: () => false }))
jest.mock('../../../TaskListView/TaskItem/TaskPresentation/CheckBoxContainer/TaskFlowModal', () => 'TaskFlowModal')
jest.mock(
    '../../../TaskListView/TaskItem/TaskPresentation/CheckBoxContainer/CheckBoxContainer',
    () => 'CheckBoxContainer'
)
jest.mock('../../../TaskListView/TaskItem/TaskCompletionAnimation', () => ({
    __esModule: true,
    default: () => null,
    ANIMATION_DURATION: 1,
}))
jest.mock('../../../UIComponents/FloatModals/RecurringTaskDateBasisModal/RecurringTaskDateBasisModal', () => ({
    __esModule: true,
    default: () => null,
    shouldShowRecurringTaskDateBasisModal: () => false,
}))
jest.mock(
    '../../../TaskListView/TaskItem/TaskPresentation/CheckBoxContainer/EmailTaskCompletionModal',
    () => 'EmailTaskCompletionModal'
)
jest.mock('../../../../utils/backends/EmailLine/emailLineBackend', () => ({
    performEmailLineAction: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../../../../utils/backends/Chats/chatsComments', () => ({
    getParentObjectData: jest.fn(),
}))
jest.mock('../../../../utils/backends/Tasks/tasksFirestore', () => ({
    moveTasksFromDone: jest.fn().mockResolvedValue(undefined),
    moveTasksFromOpen: jest.fn().mockResolvedValue(undefined),
    setTaskStatus: jest.fn(),
    watchTask: jest.fn(),
}))
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
    getProjectById: () => ({ id: 'project-1' }),
}))
jest.mock('../../../TaskListView/TaskItem/TaskPresentation/TaskPresentation', () => {
    const React = require('react')
    const CheckBoxWrapper = require('../../../TaskListView/TaskItem/TaskPresentation/CheckBoxContainer/CheckBoxWrapper')
        .default
    return props =>
        React.createElement(CheckBoxWrapper, {
            task: props.task,
            projectId: props.projectId,
            accessGranted: true,
            loggedUserCanUpdateObject: true,
        })
})
jest.mock('../../../GoalsView/GoalItemPresentation', () => 'GoalItemPresentation')
jest.mock('../../../ContactsView/ContactItem', () => 'ContactItem')
jest.mock('../../../NotesView/NotesItem', () => 'NotesItem')
jest.mock('../../../ChatsView/ChatItem', () => 'ChatItem')
jest.mock('../../../SettingsView/Profile/Skills/SkillItem/SkillPresentation', () => 'SkillPresentation')
jest.mock('../../../AdminPanel/Assistants/AssistantPresentation', () => 'AssistantPresentation')
jest.mock('./Header', () => 'Header')

import CommentPopupObjectHeader from './CommentPopupObjectHeader'
import { getParentObjectData } from '../../../../utils/backends/Chats/chatsComments'
import { moveTasksFromDone, moveTasksFromOpen } from '../../../../utils/backends/Tasks/tasksFirestore'

const task = {
    id: 'task-1',
    userId: 'user-1',
    userIds: ['user-1'],
    isSubtask: false,
    done: false,
    estimations: { open: 15 },
    genericData: true,
    isPrivate: false,
    calendarData: null,
}

describe('CommentPopupObjectHeader task interaction', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        jest.clearAllMocks()
        getParentObjectData.mockResolvedValue({ object: task })
    })

    afterEach(() => jest.useRealTimers())

    it('completes a task through the existing list-row checkbox behavior', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(
                <CommentPopupObjectHeader projectId="project-1" objectId="task-1" objectType="tasks" />
            )
            await Promise.resolve()
        })

        act(() => tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false))
        await act(async () => {
            jest.runAllTimers()
            await Promise.resolve()
        })

        expect(moveTasksFromOpen).toHaveBeenCalledTimes(1)
        expect(moveTasksFromOpen).toHaveBeenCalledWith(
            'project-1',
            task,
            'done',
            null,
            null,
            task.estimations,
            'checkbox-1',
            undefined
        )
    })

    it('reopens a completed task through the same embedded checkbox', async () => {
        const doneTask = { ...task, done: true }
        getParentObjectData.mockResolvedValue({ object: doneTask })
        let tree
        await act(async () => {
            tree = renderer.create(
                <CommentPopupObjectHeader projectId="project-1" objectId="task-1" objectType="tasks" />
            )
            await Promise.resolve()
        })

        await act(async () => {
            tree.root.findByType('CheckBoxContainer').props.onCheckboxPress(false)
            await Promise.resolve()
        })

        expect(moveTasksFromDone).toHaveBeenCalledWith('project-1', doneTask, 'open')
    })
})
