import React from 'react'
import renderer, { act } from 'react-test-renderer'
import TaskMoreOptionModal from './TaskMoreOptionModal'

jest.mock('react-redux', () => ({ useDispatch: () => jest.fn(), useSelector: () => false }))
jest.mock('../../../UIControls/CustomScrollView', () => 'CustomScrollView')
jest.mock('../../../ModalsManager/modalsManager', () => ({ storeModal: jest.fn(), removeModal: jest.fn() }))
jest.mock('../../../../redux/actions', () => ({ showFloatPopup: jest.fn(), hideFloatPopup: jest.fn() }))
jest.mock('../../../../utils/HelperFunctions', () => ({ applyPopoverWidth: () => ({}) }))
jest.mock('../ModalHeader', () => 'ModalHeader')
jest.mock('../MorePopupsOfEditModals/Common/ModalItem', () => 'ModalItem')
jest.mock('../DescriptionModal/DescriptionModal', () => 'DescriptionModal')
jest.mock('../EstimationModal/EstimationModal', () => 'EstimationModal')
jest.mock('../HighlightColorModal/HighlightColorModal', () => 'HighlightColorModal')
jest.mock('../../../TaskListView/Utils/TasksHelper', () => ({ getTaskAutoEstimation: jest.fn(), OPEN_STEP: 'open' }))
jest.mock('../PrepareMeetings/PrepareMeetingsItem', () => 'PrepareMeetingsItem')

it.each([
    [{ id: 'event-1', calendarData: {} }, 1],
    [{ calendarData: {} }, 0],
    [{ id: 'normal-task' }, 0],
])('shows preparation only for saved calendar tasks in the task popup', (task, count) => {
    const closeModal = jest.fn()
    let tree
    act(() => {
        tree = renderer.create(<TaskMoreOptionModal projectId="project-1" task={task} closeModal={closeModal} />)
    })
    const items = tree.root.findAllByType('PrepareMeetingsItem')
    expect(items).toHaveLength(count)
    if (count)
        expect(items[0].props).toMatchObject({ projectId: 'project-1', tasks: [task], specificTask: true, closeModal })
    act(() => tree.unmount())
})
