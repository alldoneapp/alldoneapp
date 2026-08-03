import React from 'react'
import renderer, { act } from 'react-test-renderer'

import ExecutionModeButton from './ExecutionModeButton'

jest.mock('../../UIControls/GhostButton', () => 'GhostButton')
jest.mock('../../../i18n/TranslationService', () => ({ translate: text => text }))

describe('ExecutionModeButton for user tasks', () => {
    test('switches a workflow user task to direct mode', () => {
        const onChange = jest.fn()
        const tree = renderer.create(
            <ExecutionModeButton task={{ assigneeType: 'USER', executionMode: 'workflow' }} onChange={onChange} />
        )
        const button = tree.root.findByType('GhostButton')

        expect(button.props.title).toBe('Use workflow')
        act(() => button.props.onPress())
        expect(onChange).toHaveBeenCalledWith('direct')
    })

    test('switches a direct user task back to workflow mode', () => {
        const onChange = jest.fn()
        const tree = renderer.create(
            <ExecutionModeButton task={{ assigneeType: 'USER', executionMode: 'direct' }} onChange={onChange} />
        )
        const button = tree.root.findByType('GhostButton')

        expect(button.props.title).toBe('Bypass workflow')
        act(() => button.props.onPress())
        expect(onChange).toHaveBeenCalledWith('workflow')
    })
})
