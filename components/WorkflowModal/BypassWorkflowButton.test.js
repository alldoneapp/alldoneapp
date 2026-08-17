import React from 'react'
import { StyleSheet, Text } from 'react-native'
import renderer from 'react-test-renderer'

import { colors } from '../styles/global'
import BypassWorkflowButton from './BypassWorkflowButton'

jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))

describe('BypassWorkflowButton', () => {
    it('renders as an understated grey text action', () => {
        const tree = renderer.create(<BypassWorkflowButton onPress={jest.fn()} />)
        const button = tree.root.findByProps({ testID: 'bypass-workflow-button' })
        const text = button.findByType(Text)

        expect(text.props.children).toBe('Bypass workflow')
        expect(StyleSheet.flatten(button.props.style)).toMatchObject({ marginTop: 0 })
        expect(StyleSheet.flatten(text.props.style)).toMatchObject({ color: colors.Text03 })
    })

    it('runs the bypass action when pressed', () => {
        const onPress = jest.fn()
        const tree = renderer.create(<BypassWorkflowButton onPress={onPress} />)
        const button = tree.root.findByProps({ testID: 'bypass-workflow-button' })

        button.props.onPress()

        expect(onPress).toHaveBeenCalledTimes(1)
    })

    it('uses a softer grey and disables interaction while the transition is pending', () => {
        const tree = renderer.create(<BypassWorkflowButton onPress={jest.fn()} disabled />)
        const button = tree.root.findByProps({ testID: 'bypass-workflow-button' })

        expect(button.props.disabled).toBe(true)
        expect(StyleSheet.flatten(button.findByType(Text).props.style)).toMatchObject({ color: colors.Text04 })
    })
})
