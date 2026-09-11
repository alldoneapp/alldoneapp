import React from 'react'
import renderer, { act } from 'react-test-renderer'

import DateTagButton from './DateTagButton'

const mockState = {
    smallScreen: false,
    currentUser: { uid: 'user-1' },
}

jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
jest.mock('../UIComponents/ModalShell/AppPopover', () => 'AppPopover')
jest.mock('../UIComponents/FloatModals/DueDateModal/DueDateModal', () => 'DueDateModal')
jest.mock('../Tags/DateTag', () => 'DateTag')
jest.mock('../UIComponents/FloatModals/DateFormatPickerModal', () => ({ getDateFormat: () => 'YYYY-MM-DD' }))
jest.mock('../../hooks/useFloatPopupLock', () => () => ({ acquire: jest.fn(), release: jest.fn() }))

describe('DateTagButton reminder picker', () => {
    it('threads both future-date and Someday writes through the row callbacks', () => {
        const saveDueDateBeforeSaveTask = jest.fn()
        const setToBacklogBeforeSaveTask = jest.fn()
        const tree = renderer.create(
            <DateTagButton
                task={{ id: 'task-1', dueDate: Date.now(), done: false }}
                projectId="project-1"
                saveDueDateBeforeSaveTask={saveDueDateBeforeSaveTask}
                setToBacklogBeforeSaveTask={setToBacklogBeforeSaveTask}
            />
        )

        act(() => tree.root.findByType('DateTag').props.onPress())

        const modal = tree.root.findByType('AppPopover').props.content
        expect(modal.props.saveDueDateBeforeSaveTask).toBe(saveDueDateBeforeSaveTask)
        expect(modal.props.setToBacklogBeforeSaveTask).toBe(setToBacklogBeforeSaveTask)
    })
})
