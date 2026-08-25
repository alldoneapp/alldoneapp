import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import OpenTasksAssistantPreConfigTasks from './OpenTasksAssistantPreConfigTasks'

let mockState
let mockTasks
const mockDispatch = jest.fn()
const mockNavigate = jest.fn()

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
    useDispatch: () => mockDispatch,
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
jest.mock('./WorkflowTaskCreator', () => ({
    __esModule: true,
    default: 'WorkflowTaskCreator',
    WorkflowConfigurationLink: 'WorkflowConfigurationLink',
}))
jest.mock('../../../MyDayView/AssistantLine/AssistantLine', () => 'AssistantLine')
// The template review banner itself is rendered for real — the defect this
// covers was the WIRING (the previous notice lived in an orphaned file), so a
// mocked banner would assert nothing. Only Button is stubbed; it subscribes to
// the real redux store in its constructor.
jest.mock('../../../UIControls/Button', () => 'Button')
jest.mock('../../../../utils/NavigationService', () => ({
    __esModule: true,
    default: { navigate: (...args) => mockNavigate(...args) },
}))
jest.mock('../../../../redux/actions', () => ({ setSelectedNavItem: tab => ({ type: 'select-tab', tab }) }))
jest.mock('../../../../utils/TabNavigationConstants', () => ({
    DV_TAB_ASSISTANT_CUSTOMIZATIONS: 'assistant-customizations',
}))

const TimelineChild = () => null

describe('assistant profile workflow task creator', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockTasks = []
        mockState = {
            currentUser: {
                uid: 'assistant-1',
                displayName: 'Project assistant',
            },
            globalAssistants: [],
            loggedUser: {
                uid: 'user-1',
                isAnonymous: false,
                realProjectIds: ['project-1'],
            },
            administratorUser: { uid: 'admin-1' },
            showFloatPopup: 0,
            loggedUserProjectsMap: {
                'project-1': { id: 'project-1', name: 'Project' },
            },
        }
    })

    it('keeps workflow configuration in the Tasks header and injects creation into the timeline', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <OpenTasksAssistantPreConfigTasks projectId="project-1">
                    <TimelineChild />
                </OpenTasksAssistantPreConfigTasks>
            )
        })

        expect(tree.root.findByType('WorkflowConfigurationLink').props).toMatchObject({
            projectId: 'project-1',
            assistant: mockState.currentUser,
        })
        expect(tree.root.findByType(TimelineChild).props.assistantTaskCreatorContext).toMatchObject({
            projectId: 'project-1',
            assistant: mockState.currentUser,
            disabled: false,
            showConfigurationLink: false,
        })
        expect(tree.root.findByType('AssistantLine').props).toMatchObject({
            projectOverride: mockState.loggedUserProjectsMap['project-1'],
            assistantIdOverride: 'assistant-1',
            showAllQuickActions: true,
            preferAssistantIdOverride: true,
            scopeLastCommentToAssistant: true,
            showEditAssistantButton: true,
        })
        act(() => tree.root.findByType('AssistantLine').props.onEditAssistant())
        expect(mockNavigate).toHaveBeenCalledWith('AssistantDetailedView', {
            assistantId: 'assistant-1',
            projectId: 'project-1',
        })
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'select-tab', tab: 'assistant-customizations' })
        expect(tree.root.findAllByType(Text).map(node => node.props.children)).toEqual(['Tasks'])
    })

    it('does not show workflow task creation for a global assistant', () => {
        mockState.globalAssistants = [{ uid: 'assistant-1' }]

        let tree
        act(() => {
            tree = renderer.create(
                <OpenTasksAssistantPreConfigTasks projectId="project-1">
                    <TimelineChild />
                </OpenTasksAssistantPreConfigTasks>
            )
        })

        expect(tree.root.findAllByType('WorkflowConfigurationLink')).toHaveLength(0)
        expect(tree.root.findByType(TimelineChild).props.assistantTaskCreatorContext).toBeNull()
        expect(tree.root.findByType('AssistantLine').props.showEditAssistantButton).toBe(false)
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

    describe('template review notice (AT-2425)', () => {
        const renderBoard = () => {
            let tree
            act(() => {
                tree = renderer.create(
                    <OpenTasksAssistantPreConfigTasks projectId="project-1">
                        <TimelineChild />
                    </OpenTasksAssistantPreConfigTasks>
                )
            })
            return tree
        }

        const copy = tree => tree.root.findAllByType(Text).map(node => node.props.children)

        const withPendingTemplateReview = () => {
            mockState.currentUser = {
                ...mockState.currentUser,
                copiedFromTemplateAssistantId: 'template-1',
                templateSyncConflicts: [{ field: 'instructions' }, { field: 'model' }],
            }
        }

        it('explains what changed on the board instead of only in the edit view', () => {
            withPendingTemplateReview()

            const text = copy(renderBoard())
            expect(text).toContain("This assistant's template was updated")
            expect(text).toContain('2 template changes need review: Instructions, Assistant model')
            expect(text).toContain('Click Edit to choose which version to keep.')
        })

        it('sends the review action to the same editor as the Edit button', () => {
            withPendingTemplateReview()
            const tree = renderBoard()

            const buttons = tree.root.findAllByType('Button')
            expect(buttons).toHaveLength(1)
            act(() => buttons[0].props.onPress())

            expect(mockNavigate).toHaveBeenCalledWith('AssistantDetailedView', {
                assistantId: 'assistant-1',
                projectId: 'project-1',
            })
            expect(mockDispatch).toHaveBeenCalledWith({ type: 'select-tab', tab: 'assistant-customizations' })
        })

        it('stays quiet when the assistant has nothing to review', () => {
            const tree = renderBoard()

            expect(copy(tree)).not.toContain("This assistant's template was updated")
            expect(tree.root.findAllByType('Button')).toHaveLength(0)
        })

        it('does not tell a read-only viewer to click an Edit button they do not have', () => {
            // A global assistant renders no Edit control (showEditAssistantButton
            // is false above), so the notice would point at nothing.
            withPendingTemplateReview()
            mockState.globalAssistants = [{ uid: 'assistant-1' }]

            const tree = renderBoard()
            expect(tree.root.findByType('AssistantLine').props.showEditAssistantButton).toBe(false)
            expect(copy(tree)).not.toContain("This assistant's template was updated")
        })
    })
})
