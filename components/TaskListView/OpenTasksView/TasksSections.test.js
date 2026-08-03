import React from 'react'
import renderer, { act } from 'react-test-renderer'

import TasksSections from './TasksSections'

let mockState

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))
jest.mock('react-beautiful-dnd', () => ({
    DragDropContext: ({ children }) => children,
}))
jest.mock('../../../redux/store', () => ({
    getState: jest.fn(() => ({})),
}))
jest.mock('../../DragSystem/DragHelper', () => ({
    onBeforeCapture: jest.fn(),
    onDragEnd: jest.fn(),
}))
jest.mock('./MainSection', () => 'MainSection')
jest.mock('./MentionSection', () => 'MentionSection')
jest.mock('./SuggestedSectionList', () => 'SuggestedSectionList')
jest.mock('./OriginallyFromSectionList', () => 'OriginallyFromSectionList')
jest.mock('./ObservedFromSectionList', () => 'ObservedFromSectionList')
jest.mock('./StreamAndUserTasksSectionList', () => 'StreamAndUserTasksSectionList')
jest.mock('./CalendarSectionContainer', () => 'CalendarSectionContainer')

describe('TasksSections assistant profile workflow tasks', () => {
    beforeEach(() => {
        const tasksByType = Array.from({ length: 12 }, () => [])
        tasksByType[6] = [['workflow-step-1', []]]
        mockState = {
            filteredOpenTasksStore: {
                instance: [tasksByType],
            },
        }
    })

    it('shows received workflow tasks in the assistant Open tab', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <TasksSections
                    projectId="project-1"
                    dateIndex={0}
                    projectIndex={0}
                    instanceKey="instance"
                    assistantProfileMode
                />
            )
        })

        expect(tree.root.findAllByType('OriginallyFromSectionList')).toHaveLength(1)
    })
})
