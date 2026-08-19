import React from 'react'
import { View } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import TasksList from './TasksList'
import { taskPresentationLayout } from '../TaskItem/TaskPresentation/TaskPresentationLayout'

let mockState

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))
jest.mock('../../DragSystem/DroppableTaskList', () => 'DroppableTaskList')
jest.mock('../ParentTaskContainer', () => 'ParentTaskContainer')
jest.mock('../TaskListSkeleton', () => 'TaskListSkeleton')
jest.mock('../../../utils/backends/openTasks', () => ({
    MAIN_TASK_INDEX: 3,
    MENTION_TASK_INDEX: 4,
    SUGGESTED_TASK_INDEX: 5,
    OBSERVED_TASKS_INDEX: 7,
    STREAM_AND_USER_TASKS_INDEX: 8,
}))
jest.mock('../../../utils/TaskPriority', () => ({
    sortTasksByPriority: tasks => tasks,
}))
jest.mock('../../../utils/editingGuard', () => ({
    useIsUserEditing: () => false,
}))
jest.mock('./focusSectionPin', () => ({
    holdWhileEditing: value => value,
}))
jest.mock('./taskPlacementHold', () => ({
    holdTaskOrder: tasks => tasks,
}))

describe('TasksList initial loading', () => {
    const tasks = [{ id: 'task-1' }, { id: 'task-2' }, { id: 'task-3' }]

    beforeEach(() => {
        mockState = {
            subtaskByTaskStore: { instance: {} },
            initialLoadingEndOpenTasks: { instance: true },
            initialLoadingEndObservedTasks: { instance: false },
            taskListSingleLoading: {},
            optimisticFocusTaskId: null,
            optimisticFocusTaskProjectId: null,
            optimisticFocusActive: false,
        }
    })

    const renderList = () =>
        renderer.create(
            <TasksList
                projectId="project-1"
                dateIndex={0}
                taskList={tasks}
                taskListIndex={3}
                amountToRender={2}
                instanceKey="instance"
            />
        )

    it('keeps the final render budget while showing ghost rows', () => {
        let tree
        act(() => {
            tree = renderList()
        })

        const skeleton = tree.root.findByType('TaskListSkeleton')
        expect(skeleton.props.rowCount).toBe(2)
        expect(skeleton.props.taskKeys).toEqual(['task-1', 'task-2'])
        expect(tree.root.findAllByType('ParentTaskContainer')).toHaveLength(0)
    })

    it('uses the shared task-list gutter', () => {
        let tree
        act(() => {
            tree = renderList()
        })

        expect(tree.root.findByType(TasksList).findByType(View).props.style).toEqual(
            expect.arrayContaining([taskPresentationLayout.listContainer])
        )
    })

    it('shows real tasks once both streams are complete', () => {
        mockState.initialLoadingEndObservedTasks.instance = true

        let tree
        act(() => {
            tree = renderList()
        })

        expect(tree.root.findAllByType('TaskListSkeleton')).toHaveLength(0)
        expect(tree.root.findAllByType('ParentTaskContainer')).toHaveLength(2)
    })

    it('keeps existing tasks visible during an incremental single-task load', () => {
        mockState.taskListSingleLoading.instance = true

        let tree
        act(() => {
            tree = renderList()
        })

        expect(tree.root.findAllByType('TaskListSkeleton')).toHaveLength(0)
        expect(tree.root.findAllByType('ParentTaskContainer')).toHaveLength(2)
    })
})
