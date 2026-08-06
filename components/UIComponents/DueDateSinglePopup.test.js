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
jest.mock('../../utils/BackendBridge', () => ({}))
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
