/**
 * @jest-environment jsdom
 */

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import ComposerModelButton from './ComposerModelButton'
import { setLanguage } from '../../../../../i18n/TranslationService'

const mockDispatch = jest.fn()
const mockState = {
    smallScreenNavigation: false,
    isMiddleScreen: false,
    loggedUser: { sidebarExpanded: false },
}

jest.mock('react-redux', () => ({
    shallowEqual: jest.fn(),
    useDispatch: () => mockDispatch,
    useSelector: selector => selector(mockState),
}))
jest.mock('../../../../../redux/actions', () => ({
    showFloatPopup: () => ({ type: 'showFloatPopup' }),
    hideFloatPopup: () => ({ type: 'hideFloatPopup' }),
}))
jest.mock('../../../../UIComponents/ModalShell/AppPopover', () => {
    const React = require('react')
    const { View } = require('react-native')
    return ({ children, content, isOpen, position, getViewport, onClickOutside }) => (
        <View
            testID="model-popover"
            isOpen={isOpen}
            position={position}
            getViewport={getViewport}
            onClickOutside={onClickOutside}
        >
            {children}
            {content}
        </View>
    )
})
jest.mock('../../../../Icon', () => 'Icon')
// The picker itself is the comment popup's, pinned in ThreadAssistantModelUI.test.js; only what it
// is handed matters here.
jest.mock('./ThreadAssistantModelModal', () => ({ __esModule: true, default: 'ThreadAssistantModelModal' }))

const renderButton = (props = {}) =>
    renderer.create(
        <ComposerModelButton
            selectedModel={null}
            assistantModel={'MODEL_GPT6_SOL'}
            onSelectModel={jest.fn()}
            {...props}
        />
    )

const buttonOf = tree => tree.root.findByProps({ testID: 'composer-model-button' })
const textOf = tree => JSON.stringify(tree.toJSON())
// The visible label only (react-native-web renders <Text> as a div holding the string).
const shownLabel = (tree, text) => textOf(tree).includes(`"children":[${JSON.stringify(text)}]`)

describe('ComposerModelButton (AT-3162)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        setLanguage('en')
    })

    it('names the assistant model while nothing is chosen', () => {
        const tree = renderButton()

        expect(shownLabel(tree, 'Sol')).toBe(true)
        expect(buttonOf(tree).props.accessibilityLabel).toBe('Select model: Sol')
        expect(tree.root.findAll(node => node.props.testID === 'composer-model-button-pinned')).toHaveLength(0)
    })

    it('names and marks a chosen model', () => {
        const tree = renderButton({ selectedModel: 'MODEL_DEEPSEEK_V4_FLASH' })

        expect(shownLabel(tree, 'DeepSeek Flash')).toBe(true)
        expect(shownLabel(tree, 'Sol')).toBe(false)
        expect(tree.root.findAll(node => node.props.testID === 'composer-model-button-pinned').length).toBeGreaterThan(
            0
        )
    })

    it('still says something true for an assistant on a model outside the menu', () => {
        const tree = renderButton({ assistantModel: 'MODEL_GPT5_5' })

        expect(buttonOf(tree).props.accessibilityLabel).toBe('Select model: Assistant default')
    })

    it('keeps the name in the accessible label when it shows only the icon', () => {
        const tree = renderButton({ compact: true, selectedModel: 'MODEL_DEEPSEEK_V4_FLASH' })

        expect(shownLabel(tree, 'DeepSeek Flash')).toBe(false)
        expect(buttonOf(tree).props.accessibilityLabel).toBe('Select model: DeepSeek Flash')
    })

    it('opens the comment popup’s model picker with the current state and closes it again', () => {
        const onSelectModel = jest.fn()
        const tree = renderButton({ selectedModel: 'MODEL_DEEPSEEK_V4_FLASH', onSelectModel })

        // Closed: the picker (and its import chain) is not mounted at all.
        expect(tree.root.findAllByType('ThreadAssistantModelModal')).toHaveLength(0)

        act(() => buttonOf(tree).props.onPress())
        const picker = tree.root.findByType('ThreadAssistantModelModal')
        expect(picker.props).toEqual(
            expect.objectContaining({
                selectedModel: 'MODEL_DEEPSEEK_V4_FLASH',
                assistantModel: 'MODEL_GPT6_SOL',
                updateModel: onSelectModel,
            })
        )
        expect(buttonOf(tree).props.accessibilityState.expanded).toBe(true)
        expect(mockDispatch).toHaveBeenCalledWith({ type: 'showFloatPopup' })

        act(() => picker.props.closeModal())
        expect(tree.root.findAllByType('ThreadAssistantModelModal')).toHaveLength(0)
        expect(mockDispatch).toHaveBeenLastCalledWith({ type: 'hideFloatPopup' })
    })

    it('hands a caller’s title and description to the picker', () => {
        const tree = renderButton({ title: 'Model for the next chat', description: 'Next chat only' })

        act(() => buttonOf(tree).props.onPress())
        expect(tree.root.findByType('ThreadAssistantModelModal').props).toEqual(
            expect.objectContaining({ title: 'Model for the next chat', description: 'Next chat only' })
        )
    })

    it('does not open while disabled', () => {
        const tree = renderButton({ disabled: true })

        act(() => buttonOf(tree).props.onPress())
        expect(tree.root.findAllByType('ThreadAssistantModelModal')).toHaveLength(0)
        expect(mockDispatch).not.toHaveBeenCalled()
    })

    it('releases the float popup flag only if it set it', () => {
        const closed = renderButton()
        act(() => closed.unmount())
        expect(mockDispatch).not.toHaveBeenCalled()

        const open = renderButton()
        act(() => buttonOf(open).props.onPress())
        act(() => open.unmount())
        expect(mockDispatch).toHaveBeenLastCalledWith({ type: 'hideFloatPopup' })
    })
})
