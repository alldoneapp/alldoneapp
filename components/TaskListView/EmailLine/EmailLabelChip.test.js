/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import { colors } from '../../styles/global'
import EmailLabelChip from './EmailLabelChip'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(selector => selector({ smallScreen: false, smallScreenNavigation: false })),
}))

jest.mock('../../Icon', () => 'Icon')

jest.mock('../../UIComponents/ModalShell/AppPopover', () => ({ children, content, isOpen }) => (
    <>
        {children}
        {isOpen ? content : null}
    </>
))

jest.mock('./EmailLabelModal/EmailLabelModal', () => 'EmailLabelModal')

describe('EmailLabelChip', () => {
    const group = {
        key: 'work',
        displayName: 'Work',
        threadCount: 5,
        entries: [],
    }

    it('uses the opaque Workflow tag surface in compact header locations', () => {
        const tree = renderer.create(<EmailLabelChip group={group} compact />)
        const triggerStyle = StyleSheet.flatten(tree.root.findByType(TouchableOpacity).props.style)

        expect(triggerStyle.backgroundColor).toBe(colors.Grey300)
    })

    it('shows the loaded total without closing the popup, including zero', () => {
        const tree = renderer.create(<EmailLabelChip group={group} />)
        const trigger = () => tree.root.findByType(TouchableOpacity)

        act(() => trigger().props.onPress())
        const modal = () => tree.root.findByType('EmailLabelModal')

        act(() => modal().props.onThreadCountReconciled(2))
        expect(trigger().props.accessibilityLabel).toBe('Work: 2')
        expect(tree.root.findAllByType(Text).some(node => node.props.children === 2)).toBe(true)
        expect(modal()).toBeTruthy()

        act(() => modal().props.onThreadCountReconciled(0))
        expect(trigger().props.accessibilityLabel).toBe('Work: 0')
        expect(tree.root.findAllByType(Text).some(node => node.props.children === 5)).toBe(false)
        expect(modal()).toBeTruthy()

        act(() => modal().props.closePopover())
        expect(tree.root.findAllByType('EmailLabelModal')).toHaveLength(0)
        expect(trigger().props.accessibilityLabel).toBe('Work: 5')
    })
})
