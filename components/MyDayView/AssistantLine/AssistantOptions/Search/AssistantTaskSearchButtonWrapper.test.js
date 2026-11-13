/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'

import AssistantTaskSearchButtonWrapper from './AssistantTaskSearchButtonWrapper'
import AssistantTaskSearchModal from './AssistantTaskSearchModal'

const mockDispatch = jest.fn()

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
}))

jest.mock('../../../../UIComponents/ModalShell/AppPopover', () => {
    const React = require('react')
    const { View } = require('react-native')
    return ({ children, content, position, getViewport }) => (
        <View testID="search-popover" position={position} getViewport={getViewport}>
            {children}
            {content}
        </View>
    )
})

jest.mock('../../../../Icon', () => 'Icon')

jest.mock('./AssistantTaskSearchModal', () => {
    const React = require('react')
    const { View } = require('react-native')
    return props => <View testID="assistant-task-search-modal" {...props} />
})

jest.mock('../../../../../i18n/TranslationService', () => ({
    translate: key => key,
}))

describe('AssistantTaskSearchButtonWrapper', () => {
    beforeEach(() => {
        mockDispatch.mockClear()
    })

    const pressButton = tree =>
        act(() => {
            tree.root.findByProps({ testID: 'assistant-task-search-button' }).props.onPress()
        })

    it('does not mount the all-project task query until Templates is opened', () => {
        let tree
        act(() => {
            tree = renderer.create(<AssistantTaskSearchButtonWrapper />)
        })

        expect(tree.root.findAllByType(AssistantTaskSearchModal)).toHaveLength(0)
        pressButton(tree)
        expect(tree.root.findByType(AssistantTaskSearchModal)).toBeTruthy()
    })

    it('is labelled Templates', () => {
        let tree
        act(() => {
            tree = renderer.create(<AssistantTaskSearchButtonWrapper />)
        })

        const button = tree.root.findByProps({ testID: 'assistant-task-search-button' })
        expect(button.props.accessibilityLabel).toBe('Templates')
        expect(JSON.stringify(tree.toJSON())).toContain('Templates')
    })

    it('shows only a search icon and the label, with no dropdown arrow (AT-3033)', () => {
        let tree
        act(() => {
            tree = renderer.create(<AssistantTaskSearchButtonWrapper />)
        })

        const iconNames = tree.root.findAllByType('Icon').map(icon => icon.props.name)
        expect(iconNames).toEqual(['search'])
    })

    it('shows only the search icon when compact', () => {
        let tree
        act(() => {
            tree = renderer.create(<AssistantTaskSearchButtonWrapper compact />)
        })

        const iconNames = tree.root.findAllByType('Icon').map(icon => icon.props.name)
        expect(iconNames).toEqual(['search'])
        expect(tree.root.findAllByType(Text)).toHaveLength(0)
    })

    it('asks the picker to list the line assistant first', () => {
        let tree
        act(() => {
            tree = renderer.create(
                <AssistantTaskSearchButtonWrapper preferredAssistantId="assistant-1" preferredProjectId="project-1" />
            )
        })

        pressButton(tree)
        const modal = tree.root.findByType(AssistantTaskSearchModal)
        expect(modal.props.preferredAssistantId).toBe('assistant-1')
        expect(modal.props.preferredProjectId).toBe('project-1')
    })

    it('opens downwards in the assistant line and takes a placement from the Anna composer (AT-3032)', () => {
        let tree
        act(() => {
            tree = renderer.create(<AssistantTaskSearchButtonWrapper />)
        })
        const popover = () => tree.root.findByProps({ testID: 'search-popover' })
        expect(popover().props.position).toEqual(['bottom', 'top', 'left', 'right'])
        expect(popover().props.getViewport).toBeUndefined()

        const getViewport = () => ({ top: 0, left: 0, right: 800, bottom: 600 })
        act(() => {
            tree.update(
                <AssistantTaskSearchButtonWrapper position={['top', 'bottom']} getPopoverViewport={getViewport} />
            )
        })
        expect(popover().props.position).toEqual(['top', 'bottom'])
        expect(popover().props.getViewport).toBe(getViewport)
    })
})
