/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import AssistantTaskSearchButtonWrapper from './AssistantTaskSearchButtonWrapper'
import AssistantTaskSearchModal from './AssistantTaskSearchModal'

const mockDispatch = jest.fn()

jest.mock('react-redux', () => ({
    useDispatch: () => mockDispatch,
}))

jest.mock('../../../../UIComponents/ModalShell/AppPopover', () => {
    const React = require('react')
    const { View } = require('react-native')
    return ({ children, content }) => (
        <View testID="search-popover">
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
})
