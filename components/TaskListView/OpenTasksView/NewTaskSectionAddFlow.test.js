import React from 'react'
import renderer, { act } from 'react-test-renderer'

import NewTaskSection from './NewTaskSection'

const mockAcquire = jest.fn()
const mockRelease = jest.fn()

jest.mock('uuid/v4', () => () => 'watcher-1')
jest.mock('../../../utils/backends/openTasks', () => ({ DATE_TASK_INDEX: 0, TODAY_DATE: '0' }))
jest.mock('../Utils/TasksHelper', () => ({ BACKLOG_DATE_STRING: 'Someday' }))
jest.mock('../../../utils/HelperFunctions', () => ({ isInputsFocused: () => false }))
jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
    useSelector: selector =>
        selector({
            filteredOpenTasksStore: { instance: [['20260916']] },
            addTaskSectionToOpenData: null,
        }),
}))
jest.mock('../../../hooks/useAddTaskCreationLock', () => () => ({
    acquire: mockAcquire,
    release: mockRelease,
}))
jest.mock('../../UIComponents/DismissibleItem', () => {
    const React = require('react')

    return React.forwardRef(({ defaultComponent, modalComponent }, ref) => {
        const [visible, setVisible] = React.useState(false)
        React.useImperativeHandle(ref, () => ({
            toggleModal: () => setVisible(value => !value),
            openModal: () => setVisible(true),
            modalIsVisible: () => visible,
        }))
        return visible ? modalComponent : defaultComponent
    })
})
jest.mock('../AddTask', () => 'AddTask')
jest.mock('../TaskItem/EditTask', () => 'EditTask')
jest.mock('../../../utils/BackendBridge', () => ({
    __esModule: true,
    default: { watchGoal: jest.fn(), unwatch: jest.fn() },
}))
jest.mock('../../../redux/store', () => ({
    __esModule: true,
    default: { getState: () => ({ blockShortcuts: false, lastAddNewTaskDate: null }) },
}))
jest.mock('../../../redux/actions', () => ({
    setAddTaskSectionToOpenData: value => ({ type: 'Set add task section to open data', value }),
}))

describe('NewTaskSection add-flow visibility (AT-2599)', () => {
    beforeEach(() => jest.clearAllMocks())

    it('holds the task-creation lock for the lifetime of the inline editor', () => {
        const tree = renderer.create(<NewTaskSection projectId="project-1" instanceKey="instance" dateIndex={0} />)

        act(() => tree.root.findByType('AddTask').props.toggleModal())
        expect(mockAcquire).toHaveBeenCalledTimes(1)
        expect(mockRelease).not.toHaveBeenCalled()

        act(() => tree.root.findByType('EditTask').props.onCancelAction())
        expect(mockRelease).toHaveBeenCalledTimes(1)
    })
})
