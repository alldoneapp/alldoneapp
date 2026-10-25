/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import renderer from 'react-test-renderer'

import IntegrationsLinkProperty from '../../../components/ProjectDetailedView/ProjectProperties/IntegrationsLink/IntegrationsLinkProperty'
import Icon from '../../../components/Icon'

jest.mock('../../../components/SettingsView/SettingsHelper', () => ({
    __esModule: true,
    default: { processURLSettingsTab: jest.fn() },
}))

describe('IntegrationsLinkProperty', () => {
    it('keeps the label and short settings link on one standard property row', () => {
        const component = renderer.create(<IntegrationsLinkProperty />)
        const row = component.root.findAllByType(View)[0]
        const link = component.root.findByType(TouchableOpacity)
        const labelText = component.root.find(node => node.type === Text && node.props.children === 'Email & Calendar')
        const linkText = component.root.find(
            node => node.type === Text && node.props.children === 'Settings → Integrations'
        )
        const [labelIcon] = component.root.findAllByType(Icon)

        expect(StyleSheet.flatten(row.props.style)).toMatchObject({
            alignItems: 'center',
            flexDirection: 'row',
            height: 56,
            justifyContent: 'space-between',
        })
        expect(labelIcon.props).toMatchObject({ name: 'link', size: 24 })
        expect(StyleSheet.flatten(labelIcon.props.style)).toMatchObject({ marginHorizontal: 8 })
        expect(labelText.props.numberOfLines).toBe(1)
        expect(linkText.props.children).toBe('Settings → Integrations')
        expect(linkText.props.numberOfLines).toBe(1)
        expect(StyleSheet.flatten(linkText.props.style)).toMatchObject({
            fontFamily: 'Roboto-Regular',
            fontSize: 11,
        })
        expect(StyleSheet.flatten(link.props.style)).toMatchObject({ justifyContent: 'flex-end' })
    })
})
