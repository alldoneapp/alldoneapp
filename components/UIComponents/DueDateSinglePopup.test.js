import React from 'react'
import renderer from 'react-test-renderer'

import DueDateSinglePopup from './DueDateSinglePopup'
import { popoverToCenter, popoverToTopContainerStyle } from '../../utils/HelperFunctions'

const mockState = {
    loggedUser: { showAllProjectsByTime: false },
    route: 'Tasks',
    selectedSidebarTab: 'Tasks',
    taskViewToggleIndex: 0,
    selectedProjectIndex: 0,
    currentUser: { uid: 'user-1' },
    smallScreenNavigation: false,
    showSwipeDueDatePopup: {
        data: {
            projectId: 'project-1',
            task: { id: 'task-1' },
        },
    },
}

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector => selector(mockState),
}))
jest.mock('react-tiny-popover', () => 'Popover')
jest.mock('../UIComponents/FloatModals/DueDateModal/DueDateModal', () => 'DueDateModal')
const mockUpdateGoalAssigneeReminderDate = jest.fn()
jest.mock('../../utils/BackendBridge', () => ({
    __esModule: true,
    default: {
        updateGoalAssigneeReminderDate: (...args) => mockUpdateGoalAssigneeReminderDate(...args),
    },
}))
jest.mock('../../utils/backends/Tasks/tasksFirestore', () => ({
    setTaskDueDate: jest.fn(),
    setTaskToBacklog: jest.fn(),
}))
jest.mock('../MyDayView/MyDayTasks/MyDayOpenTasks/myDayOpenTasksHelper', () => ({
    checkIfInMyDayOpenTab: jest.fn(() => false),
}))
jest.mock('../../redux/actions', () => ({
    hideFloatPopup: jest.fn(),
    hideSwipeDueDatePopup: jest.fn(),
    setSwipeDueDatePopupData: jest.fn(),
}))
jest.mock('../../utils/HelperFunctions', () => ({
    popoverToCenter: jest.fn(() => ({ top: 80, left: 100 })),
    popoverToTopContainerStyle: { position: 'fixed' },
}))

describe('DueDateSinglePopup positioning', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        mockState.smallScreenNavigation = false
    })

    it('uses fixed viewport positioning and accounts for the desktop sidebar', () => {
        const tree = renderer.create(<DueDateSinglePopup />)
        const popover = tree.root.findByType('Popover')
        const positioningData = { popoverRect: { width: 305, height: 400 } }

        expect(popover.props.containerStyle).toBe(popoverToTopContainerStyle)
        expect(popover.props.contentLocation(positioningData)).toEqual({ top: 80, left: 100 })
        expect(popoverToCenter).toHaveBeenCalledWith(positioningData, false)

        tree.unmount()
    })

    it('centers against the full viewport on small screens', () => {
        mockState.smallScreenNavigation = true
        const tree = renderer.create(<DueDateSinglePopup />)
        const popover = tree.root.findByType('Popover')
        const positioningData = { popoverRect: { width: 288, height: 400 } }

        popover.props.contentLocation(positioningData)

        expect(popoverToCenter).toHaveBeenCalledWith(positioningData, true)

        tree.unmount()
    })
})

// AT-2160
describe('DueDateSinglePopup goal reminder write', () => {
    const goal = { id: 'goal-1', assigneesReminderDate: { 'user-1': 1 } }

    beforeEach(() => {
        jest.clearAllMocks()
        mockState.smallScreenNavigation = false
        mockState.showSwipeDueDatePopup.data = { projectId: 'project-1', task: { id: 'task-1' }, goal }
    })

    afterEach(() => {
        mockState.showSwipeDueDatePopup.data = { projectId: 'project-1', task: { id: 'task-1' } }
    })

    // Without the goal it already holds, the backend re-reads the goal document before it can
    // write — a full round trip in front of every goal postpone made from this popup.
    it('hands the loaded goal to the backend so it does not re-read it first', () => {
        const tree = renderer.create(<DueDateSinglePopup />)
        // Popover is mocked as a host element, so its content stays an unrendered element prop.
        const modal = tree.root.findByType('Popover').props.content.props.children

        modal.props.updateParentGoalReminderDate(4242)

        expect(mockUpdateGoalAssigneeReminderDate).toHaveBeenCalledWith('project-1', 'goal-1', 'user-1', 4242, goal)

        tree.unmount()
    })
})
