import React from 'react'
import renderer from 'react-test-renderer'

import CheckboxAndIcon from './CheckboxAndIcon'

let mockState

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))
jest.mock('../../Icon', () => 'Icon')
jest.mock('./TaskCheckbox', () => 'TaskCheckbox')
jest.mock('./TaskAssistantButton', () => 'TaskAssistantButton')

const renderInlineTaskIcon = overrides =>
    renderer.create(
        <CheckboxAndIcon
            tmpTask={{ id: 'task-1', name: 'Prepare launch', subtaskIds: [] }}
            isSubtask={false}
            adding={false}
            accessGranted={true}
            showArrowInAnonymous={true}
            loggedUserCanUpdateObject={true}
            isAssistant={false}
            projectId="project-1"
            {...overrides}
        />
    )

describe('CheckboxAndIcon inline task-detail path', () => {
    test.each([false, true])('uses the assistant avatar control instead of the processor icon (tablet: %s)', tablet => {
        mockState = { isMiddleScreen: tablet }
        const tree = renderInlineTaskIcon()

        expect(tree.root.findAllByType('Icon')).toHaveLength(0)
        expect(tree.root.findByType('TaskAssistantButton').props).toEqual(
            expect.objectContaining({
                projectId: 'project-1',
                task: expect.objectContaining({ id: 'task-1' }),
                disabled: false,
            })
        )
    })

    test('keeps the checkbox fallback for subtasks', () => {
        mockState = { isMiddleScreen: false }
        const tree = renderInlineTaskIcon({ isSubtask: true })

        expect(tree.root.findAllByType('TaskAssistantButton')).toHaveLength(0)
        expect(tree.root.findByType('TaskCheckbox')).toBeTruthy()
    })
})
