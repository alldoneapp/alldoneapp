/**
 * @jest-environment jsdom
 */

import React from 'react'
import { TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import EmailLineMenu from './EmailLineMenu'

jest.mock('../../../i18n/TranslationService', () => ({
    translate: jest.fn(textKey => textKey),
}))

const findByLabel = (tree, label) =>
    tree.root.find(node => node.type === TouchableOpacity && node.props.accessibilityLabel === label)

describe('EmailLineMenu', () => {
    it('runs Done for today and closes the menu', () => {
        const closePopover = jest.fn()
        const onDoneForToday = jest.fn()
        let tree
        act(() => {
            tree = renderer.create(
                <EmailLineMenu
                    closePopover={closePopover}
                    onDoneForToday={onDoneForToday}
                    onOpenIntegrations={jest.fn()}
                />
            )
        })
        act(() => findByLabel(tree, 'Done for today').props.onPress())
        expect(closePopover).toHaveBeenCalled()
        expect(onDoneForToday).toHaveBeenCalled()
    })

    it('opens Integrations settings and closes the menu', () => {
        const closePopover = jest.fn()
        const onOpenIntegrations = jest.fn()
        let tree
        act(() => {
            tree = renderer.create(
                <EmailLineMenu
                    closePopover={closePopover}
                    onDoneForToday={jest.fn()}
                    onOpenIntegrations={onOpenIntegrations}
                />
            )
        })
        act(() => findByLabel(tree, 'Integrations').props.onPress())
        expect(closePopover).toHaveBeenCalled()
        expect(onOpenIntegrations).toHaveBeenCalled()
    })
})
