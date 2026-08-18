import React from 'react'
import renderer from 'react-test-renderer'

import AllProjectsEmptyInboxAddTask from './AllProjectsEmptyInboxAddTask'
import { AUTOMATIC_PROJECT_OPTION } from '../../UIComponents/FloatModals/SelectProjectModal/projectPickerConstants'

jest.mock('../../Tags/AddTaskTag', () => 'AddTaskTag')

describe('AllProjectsEmptyInboxAddTask', () => {
    it('opens the add-task popup on the Automatic project option (AT-2306)', () => {
        const button = renderer.create(<AllProjectsEmptyInboxAddTask />).root.findByType('AddTaskTag')

        expect(button.props.projectId).toBe(AUTOMATIC_PROJECT_OPTION)
        expect(button.props.showProjectSelector).toBe(true)
        // Without the large variant this renders as the same 24px pill as the
        // one in the header line, which is not a "day is done, start something"
        // call to action.
        expect(button.props.large).toBe(true)
        expect(button.props.primary).toBe(true)
    })
})
