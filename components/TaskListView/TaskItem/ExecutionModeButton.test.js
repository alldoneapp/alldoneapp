import React from 'react'
import renderer, { act } from 'react-test-renderer'

import ExecutionModeButton, { shouldShowExecutionModeButton } from './ExecutionModeButton'

jest.mock('../../UIControls/GhostButton', () => 'GhostButton')
jest.mock('../../../i18n/TranslationService', () => ({ translate: text => text }))

describe('ExecutionModeButton for user tasks', () => {
    test('is only shown while creating a non-calendar task', () => {
        expect(shouldShowExecutionModeButton(true, { calendarData: null })).toBe(true)
        expect(shouldShowExecutionModeButton(false, { calendarData: null })).toBe(false)
        expect(shouldShowExecutionModeButton(true, { calendarData: { eventId: 'event-id' } })).toBe(false)
    })

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

    test('can render icon-only while keeping the accessible mode label', () => {
        const tree = renderer.create(
            <ExecutionModeButton
                task={{ assigneeType: 'USER', executionMode: 'workflow' }}
                onChange={jest.fn()}
                iconOnly
            />
        )
        const button = tree.root.findByType('GhostButton')

        expect(button.props.icon).toBe('git-branch')
        expect(button.props.title).toBeNull()
        expect(button.props.accessibilityLabel).toBe('Use workflow')
    })
})
