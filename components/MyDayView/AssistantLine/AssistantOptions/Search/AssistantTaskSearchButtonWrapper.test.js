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

jest.mock('../OptionButtons/OptionButton', () => {
    const React = require('react')
    const { TouchableOpacity } = require('react-native')
    return ({ onPress }) => <TouchableOpacity testID="search-button" onPress={onPress} />
})

jest.mock('./AssistantTaskSearchModal', () => {
    const React = require('react')
    const { View } = require('react-native')
    return () => <View testID="assistant-task-search-modal" />
})

jest.mock('../../../../../i18n/TranslationService', () => ({
    translate: key => key,
}))

describe('AssistantTaskSearchButtonWrapper', () => {
    beforeEach(() => {
        mockDispatch.mockClear()
    })

    it('does not mount the all-project task query until Search is opened', () => {
        let tree
        act(() => {
            tree = renderer.create(<AssistantTaskSearchButtonWrapper />)
        })

        expect(tree.root.findAllByType(AssistantTaskSearchModal)).toHaveLength(0)

        act(() => {
            tree.root.findByProps({ testID: 'search-button' }).props.onPress()
        })

        expect(tree.root.findByType(AssistantTaskSearchModal)).toBeTruthy()
    })
})
