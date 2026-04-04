import React from 'react'
import renderer from 'react-test-renderer'
import { Text } from 'react-native'

import AutoPostponeAfterDaysOverdue from './AutoPostponeAfterDaysOverdue'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(selector => selector({ smallScreen: false })),
}))

jest.mock('react-tiny-popover', () => {
    return ({ children }) => children
})

jest.mock('../../../Icon', () => 'Icon')
jest.mock('../../../../i18n/TranslationService', () => ({
    translate: jest.fn((text, interpolations = {}) => {
        if (text === 'Amount days') return `${interpolations.amount} days`
        return text
    }),
}))

jest.mock('../../../UIControls/Button', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return ({ title }) => <Text>{title}</Text>
})

jest.mock(
    '../../../UIComponents/FloatModals/AutoPostponeAfterDaysOverdueModal',
    () => 'AutoPostponeAfterDaysOverdueModal'
)

describe('AutoPostponeAfterDaysOverdue', () => {
    test('shows the default 3 days label when the user setting is missing', () => {
        const tree = renderer.create(
            <AutoPostponeAfterDaysOverdue userId="user-1" autoPostponeAfterDaysOverdue={undefined} />
        ).root

        const textValues = tree.findAllByType(Text).map(node => node.props.children)
        expect(textValues).toContain('3 days')
    })

    test('shows Never when the setting is disabled', () => {
        const tree = renderer.create(<AutoPostponeAfterDaysOverdue userId="user-1" autoPostponeAfterDaysOverdue={0} />)
            .root

        const textValues = tree.findAllByType(Text).map(node => node.props.children)
        expect(textValues).toContain('Never')
    })
})
