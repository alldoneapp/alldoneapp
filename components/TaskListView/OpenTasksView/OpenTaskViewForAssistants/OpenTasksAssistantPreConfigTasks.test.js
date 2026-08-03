import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import OpenTasksAssistantPreConfigTasks from './OpenTasksAssistantPreConfigTasks'

let mockState
let mockTasks

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))
jest.mock('uuid/v4', () => () => 'watcher-1')
jest.mock('../../../../utils/backends/Assistants/assistantsFirestore', () => ({
    watchAssistantTasks: jest.fn((projectId, assistantId, watcherKey, callback) => callback(mockTasks)),
}))
jest.mock('../../../../utils/backends/firestore', () => ({ unwatch: jest.fn() }))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../../../TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    default: { getPeopleById: userId => ({ uid: userId, preferredTimezone: 'UTC' }) },
    RECURRENCE_NEVER: 'never',
    RECURRENCE_DAILY: 'daily',
    RECURRENCE_ONCE: 'once',
    getCustomRecurrenceDays: () => null,
}))
jest.mock('../../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal', () => ({ TASK_TYPE_PROMPT: 'prompt' }))
jest.mock('../../../AdminPanel/Assistants/assistantsHelper', () => ({ GLOBAL_PROJECT_ID: 'globalProject' }))
jest.mock('./WhatsAppAssistantLine', () => 'WhatsAppAssistantLine')
jest.mock('./WorkflowTaskCreator', () => 'WorkflowTaskCreator')
jest.mock('../../../MyDayView/AssistantLine/AssistantLine', () => 'AssistantLine')

const TimelineChild = () => null

describe('assistant profile workflow task creator', () => {
    beforeEach(() => {
        mockTasks = []
        mockState = {
            currentUser: {
                uid: 'assistant-1',
                displayName: 'Project assistant',
            },
            globalAssistants: [],
            loggedUser: {
                isAnonymous: false,
                realProjectIds: ['project-1'],
            },
            loggedUserProjectsMap: {
                'project-1': { id: 'project-1', name: 'Project' },
            },
        }
    })

    it('shows workflow task creation beside the project assistant pre-configured tasks', () => {
        let tree
        act(() => {
            tree = renderer.create(<OpenTasksAssistantPreConfigTasks projectId="project-1" />)
        })

        const creator = tree.root.findByType('WorkflowTaskCreator')
        expect(creator.props).toMatchObject({
            projectId: 'project-1',
            assistant: mockState.currentUser,
            disabled: false,
        })
        expect(tree.root.findByType('AssistantLine').props).toMatchObject({
            projectOverride: mockState.loggedUserProjectsMap['project-1'],
            assistantIdOverride: 'assistant-1',
            showAllQuickActions: true,
            preferAssistantIdOverride: true,
            scopeLastCommentToAssistant: true,
        })
        expect(tree.root.findAllByType(Text).map(node => node.props.children)).toEqual(['Tasks'])
    })

    it('does not show workflow task creation for a global assistant', () => {
        mockState.globalAssistants = [{ uid: 'assistant-1' }]

        let tree
        act(() => {
            tree = renderer.create(<OpenTasksAssistantPreConfigTasks projectId="project-1" />)
        })

        expect(tree.root.findAllByType('WorkflowTaskCreator')).toHaveLength(0)
    })

    it('delegates all quick actions to the assistant line and only injects schedules into the timeline', () => {
        mockTasks = [
            { id: 'prompt', type: 'prompt', recurrence: 'never' },
            { id: 'link', type: 'link', recurrence: 'never' },
            {
                id: 'schedule',
                type: 'prompt',
                name: 'Daily report',
                recurrence: 'daily',
                recurrenceByUser: { 'user-1': 'daily' },
                startDate: Date.now(),
                startTime: '09:00',
            },
        ]

        let tree
        act(() => {
            tree = renderer.create(
                <OpenTasksAssistantPreConfigTasks projectId="project-1">
                    <TimelineChild />
                </OpenTasksAssistantPreConfigTasks>
            )
        })

        expect(tree.root.findByType('AssistantLine')).toBeDefined()
        expect(tree.root.findByType(TimelineChild).props.assistantScheduleOccurrences).toHaveLength(1)
        expect(tree.root.findByType(TimelineChild).props.assistantScheduleContext).toMatchObject({
            tasksProjectId: 'project-1',
            assistant: mockState.currentUser,
            disabled: false,
        })
    })
})
