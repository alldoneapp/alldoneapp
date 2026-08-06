import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Image } from 'react-native'

import SuggestedSection from './SuggestedSection'
import TasksHelper from '../Utils/TasksHelper'

let mockState

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))
jest.mock('../Utils/TasksHelper', () => ({
    getUserInProject: jest.fn(),
    getContactInProject: jest.fn(),
}))
jest.mock('../../AdminPanel/Assistants/assistantsHelper', () => ({
    getAssistantFromState: (state, assistantId) => state.assistantsById[assistantId] || null,
}))
jest.mock('../../../i18n/TranslationService', () => ({
    translate: key => key,
}))
jest.mock('../../../utils/backends/openTasks', () => ({
    SUGGESTED_TASK_INDEX: 2,
    NOT_PARENT_GOAL_INDEX: 'no-goal',
    sortGoalTasksGorups: () => ({ 'no-goal': 0 }),
}))
jest.mock('./ParentGoalSection', () => 'ParentGoalSection')
jest.mock('./TasksList', () => 'TasksList')
jest.mock('./GeneralTasksHeader', () => 'GeneralTasksHeader')
jest.mock('./SwipeableGeneralTasksHeader', () => 'SwipeableGeneralTasksHeader')
jest.mock('../../Suggeted/SuggestedBulkActions', () => 'SuggestedBulkActions')

const assistantTask = {
    id: 'task-1',
    suggestedBy: 'assistant-1',
    taskMetadata: { assistantSuggestion: { assistantId: 'assistant-1' } },
}

const renderSection = task => {
    let tree
    act(() => {
        tree = renderer.create(
            <SuggestedSection
                projectId="project-1"
                taskByGoalsList={[['no-goal', [task]]]}
                dateIndex={0}
                suggestedUserId={task.suggestedBy}
                isActiveOrganizeMode={false}
                nestedTaskListIndex={0}
                instanceKey="instance"
            />
        )
    })
    return tree
}

describe('SuggestedSection suggestion identity', () => {
    beforeEach(() => {
        mockState = {
            subtaskByTaskStore: { instance: {} },
            openMilestonesByProjectInTasks: { 'project-1': [] },
            doneMilestonesByProjectInTasks: { 'project-1': [] },
            goalsByProjectInTasks: { 'project-1': {} },
            currentUser: { uid: 'user-1' },
            assistantsById: {},
        }
        TasksHelper.getUserInProject.mockReturnValue(null)
        TasksHelper.getContactInProject.mockReturnValue(null)
    })

    test('shows the assistant display name and avatar', () => {
        mockState.assistantsById['assistant-1'] = {
            uid: 'assistant-1',
            displayName: 'Anna Alldone',
            photoURL50: 'anna.jpg',
        }

        const tree = renderSection(assistantTask)

        expect(JSON.stringify(tree.toJSON())).toContain('Suggested by')
        expect(JSON.stringify(tree.toJSON())).toContain('Anna')
        expect(tree.root.findByType(Image).props.source).toEqual({ uri: 'anna.jpg' })
    })

    test('falls back to Assistant when the assistant record is unavailable', () => {
        const tree = renderSection(assistantTask)

        expect(JSON.stringify(tree.toJSON())).toContain('Assistant')
        expect(JSON.stringify(tree.toJSON())).not.toContain('Unknown user')
    })

    test('preserves the human suggester display', () => {
        const humanTask = { id: 'task-2', suggestedBy: 'user-2', creatorId: 'user-2' }
        TasksHelper.getUserInProject.mockReturnValue({
            uid: 'user-2',
            displayName: 'Karsten Wysk',
            photoURL: 'karsten.jpg',
        })

        const tree = renderSection(humanTask)

        expect(JSON.stringify(tree.toJSON())).toContain('Karsten')
        expect(tree.root.findByType(Image).props.source).toEqual({ uri: 'karsten.jpg' })
    })
})

describe('SuggestedSection bulk actions', () => {
    beforeEach(() => {
        mockState = {
            subtaskByTaskStore: { instance: {} },
            openMilestonesByProjectInTasks: { 'project-1': [] },
            doneMilestonesByProjectInTasks: { 'project-1': [] },
            goalsByProjectInTasks: { 'project-1': {} },
            currentUser: { uid: 'user-1' },
            assistantsById: {},
        }
        TasksHelper.getUserInProject.mockReturnValue(null)
        TasksHelper.getContactInProject.mockReturnValue(null)
    })

    const renderSectionWithGroups = taskByGoalsList => {
        let tree
        act(() => {
            tree = renderer.create(
                <SuggestedSection
                    projectId="project-1"
                    taskByGoalsList={taskByGoalsList}
                    dateIndex={0}
                    suggestedUserId="assistant-1"
                    isActiveOrganizeMode={false}
                    nestedTaskListIndex={0}
                    instanceKey="instance"
                />
            )
        })
        return tree
    }

    test('hands the whole section to the bulk actions, flattened across goals', () => {
        const tree = renderSectionWithGroups([
            [
                'no-goal',
                [
                    { ...assistantTask, id: 'task-1' },
                    { ...assistantTask, id: 'task-2' },
                ],
            ],
        ])

        const bulkActions = tree.root.findByType('SuggestedBulkActions')
        expect(bulkActions.props.projectId).toBe('project-1')
        expect(bulkActions.props.tasks.map(task => task.id)).toEqual(['task-1', 'task-2'])
    })

    test('never passes a task suggested by somebody else into the bulk actions', () => {
        const tree = renderSectionWithGroups([
            [
                'no-goal',
                [
                    { ...assistantTask, id: 'task-1' },
                    { id: 'task-2', suggestedBy: 'user-9', creatorId: 'user-9' },
                ],
            ],
        ])

        expect(tree.root.findByType('SuggestedBulkActions').props.tasks.map(task => task.id)).toEqual(['task-1'])
    })
})
