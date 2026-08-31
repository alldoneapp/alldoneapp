import React from 'react'
import renderer, { act } from 'react-test-renderer'

import GoalDateTagButton from './GoalDateTagButton'

const mockUpdateGoalAssigneeReminderDate = jest.fn()
const mockDispatch = jest.fn()
const mockState = {
    smallScreen: false,
    currentUser: { uid: 'user-1' },
}

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
    useSelector: selector => selector(mockState),
}))
jest.mock('../UIComponents/ModalShell/AppPopover', () => 'AppPopover')
jest.mock('../UIComponents/FloatModals/DueDateModal/DueDateModal', () => 'DueDateModal')
jest.mock('../UIComponents/FloatModals/DateFormatPickerModal', () => ({ getDateFormat: () => 'DD.MM.YYYY' }))
jest.mock('../Tags/DateTag', () => 'DateTag')
jest.mock('../TaskListView/Utils/TasksHelper', () => ({ BACKLOG_DATE_NUMERIC: Number.MAX_SAFE_INTEGER }))
jest.mock('../../utils/BackendBridge', () => ({
    __esModule: true,
    default: {
        updateGoalAssigneeReminderDate: (...args) => mockUpdateGoalAssigneeReminderDate(...args),
    },
}))
jest.mock('../../redux/actions', () => ({
    hideFloatPopup: jest.fn(() => ({ type: 'hide' })),
    showFloatPopup: jest.fn(() => ({ type: 'show' })),
}))

describe('GoalDateTagButton reminder write', () => {
    test('passes its loaded goal so the write does not wait for a server reread', () => {
        const goal = {
            id: 'goal-1',
            assigneesReminderDate: { 'user-1': 100 },
            startingMilestoneDate: 100,
            completionMilestoneDate: 200,
        }
        let tree
        act(() => {
            tree = renderer.create(
                <GoalDateTagButton
                    projectId="project-1"
                    goal={goal}
                    isEmptyGoal={true}
                    parentGoaltasks={[]}
                    areObservedTask={false}
                    inParentGoal={true}
                />
            )
        })

        act(() => tree.root.findByType('DateTag').props.onPress())
        const dueDateModal = tree.root.findByType('AppPopover').props.content
        dueDateModal.props.updateParentGoalReminderDate(4242)

        expect(mockUpdateGoalAssigneeReminderDate).toHaveBeenCalledWith('project-1', 'goal-1', 'user-1', 4242, goal)

        tree.unmount()
    })
})
