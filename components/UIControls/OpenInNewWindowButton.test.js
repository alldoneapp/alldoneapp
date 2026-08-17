/**
 * @jest-environment jsdom
 *
 * AT-2345 — wiring test. utils/openInNewWindow.test.js pins WHAT the helper opens; this pins
 * that the two surfaces users actually click (the detailed-view header button and the
 * more-menu item) both go through it instead of calling window.open themselves again.
 */
import React from 'react'
import renderer from 'react-test-renderer'

import OpenInNewWindowButton from './OpenInNewWindowButton'
import OpenInNewWindowModalItem from '../UIComponents/FloatModals/MorePopupsOfMainViews/Common/OpenInNewWindowModalItem'
import { openViewInNewWindow } from '../../utils/openInNewWindow'

jest.mock('../../utils/openInNewWindow', () => ({
    openViewInNewWindow: jest.fn(() => ({ focus: jest.fn() })),
}))

jest.mock('../UIComponents/FloatModals/MorePopupsOfEditModals/Common/ModalItem', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return props => <Text {...props}>{props.text}</Text>
})

// `findAll` also matches the component element itself, whose onPress prop is the caller's
// dismiss callback — look only at the rendered children.
const findInnerPressable = (tree, componentType) =>
    tree.root.findAll(node => typeof node.props.onPress === 'function' && node.type !== componentType)[0]

let windowOpenSpy

beforeEach(() => {
    jest.clearAllMocks()
    windowOpenSpy = jest.fn()
    window.open = windowOpenSpy
})

describe('OpenInNewWindowButton', () => {
    test('routes the press through the shared helper, not through window.open', () => {
        const tree = renderer.create(<OpenInNewWindowButton />)
        const touchable = findInnerPressable(tree, OpenInNewWindowButton)

        touchable.props.onPress()

        expect(openViewInNewWindow).toHaveBeenCalledTimes(1)
        expect(windowOpenSpy).not.toHaveBeenCalled()
    })
})

describe('OpenInNewWindowModalItem', () => {
    test('routes the press through the shared helper and still closes the menu', () => {
        const onPress = jest.fn()
        const tree = renderer.create(<OpenInNewWindowModalItem onPress={onPress} shortcut={'2'} />)
        const item = findInnerPressable(tree, OpenInNewWindowModalItem)

        item.props.onPress()

        expect(openViewInNewWindow).toHaveBeenCalledTimes(1)
        expect(windowOpenSpy).not.toHaveBeenCalled()
        // The menu must still dismiss — the helper replaced window.open, not the callback.
        expect(onPress).toHaveBeenCalledTimes(1)
    })

    test('tolerates being rendered without an onPress callback', () => {
        const tree = renderer.create(<OpenInNewWindowModalItem />)
        const item = findInnerPressable(tree, OpenInNewWindowModalItem)

        expect(() => item.props.onPress()).not.toThrow()
        expect(openViewInNewWindow).toHaveBeenCalledTimes(1)
    })
})
