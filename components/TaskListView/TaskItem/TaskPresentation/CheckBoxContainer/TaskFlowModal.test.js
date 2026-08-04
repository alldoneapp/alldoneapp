import React from 'react'
import renderer from 'react-test-renderer'

jest.mock('react-redux', () => ({
    useSelector: selector =>
        selector({
            loggedUser: { uid: 'logged-user' },
            isQuillTagEditorOpen: false,
            openModals: {},
        }),
}))
jest.mock('../../../../FollowUp/FollowUpModal', () => 'FollowUpModal')
jest.mock('../../../../WorkflowModal/WorkflowModal', () => 'WorkflowModal')
jest.mock('../../../../ModalsManager/modalsManager', () => ({ MENTION_MODAL_ID: 'mention' }))
jest.mock('../../../../Suggeted/SuggestedModal', () => 'SuggestedModal')
jest.mock(
    '../../../../UIComponents/FloatModals/WorkflowObserverModal/WorkflowObserverModal',
    () => 'WorkflowObserverModal'
)
jest.mock('../../../../Workstreams/WorkstreamHelper', () => ({ WORKSTREAM_ID_PREFIX: 'ws_' }))
jest.mock('../../../Utils/TasksHelper', () => ({
    __esModule: true,
    default: {
        getTaskOwner: () => ({ recorderUserId: null, workflow: {} }),
    },
}))

import TaskFlowModal from './TaskFlowModal'

describe('TaskFlowModal suggestions', () => {
    test('shows acceptance before observer or specialized workflow actions', () => {
        const task = { id: 'task-1', userId: 'user-1', suggestedBy: 'user-2', isPrivate: false }
        const tree = renderer.create(
            <TaskFlowModal
                task={task}
                projectId={'project-1'}
                isObservedTask={true}
                isToReviewTask={false}
                isSuggested={true}
                cancelPopover={jest.fn()}
                checkBoxIdRef={{ current: 'checkbox-1' }}
                setVisiblePopover={jest.fn()}
            />
        )

        expect(tree.root.findByType('SuggestedModal').props.task).toBe(task)
        expect(tree.root.findAllByType('WorkflowObserverModal')).toHaveLength(0)
        expect(tree.root.findAllByType('WorkflowModal')).toHaveLength(0)
        expect(tree.root.findAllByType('FollowUpModal')).toHaveLength(0)
    })

    test('keeps observer actions for tasks without an unresolved suggestion', () => {
        const task = { id: 'task-1', userId: 'user-1', suggestedBy: null, isPrivate: false }
        const tree = renderer.create(
            <TaskFlowModal
                task={task}
                projectId={'project-1'}
                isObservedTask={true}
                isToReviewTask={false}
                isSuggested={false}
                cancelPopover={jest.fn()}
                checkBoxIdRef={{ current: 'checkbox-1' }}
                setVisiblePopover={jest.fn()}
            />
        )

        expect(tree.root.findByType('WorkflowObserverModal').props.task).toBe(task)
        expect(tree.root.findAllByType('SuggestedModal')).toHaveLength(0)
    })
})
