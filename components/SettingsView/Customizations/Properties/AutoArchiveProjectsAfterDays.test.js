import React from 'react'
import renderer from 'react-test-renderer'
import { Text } from 'react-native'

import AutoArchiveProjectsAfterDays from './AutoArchiveProjectsAfterDays'

jest.mock('react-redux', () => ({
    useSelector: jest.fn(selector => selector({ smallScreen: false })),
}))

jest.mock(
    'react-tiny-popover',
    () =>
        ({ children }) =>
            children
)
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
    '../../../UIComponents/FloatModals/AutoArchiveProjectsAfterDaysModal',
    () => 'AutoArchiveProjectsAfterDaysModal'
)

describe('AutoArchiveProjectsAfterDays', () => {
    test('shows the default 30 days when the setting is missing', () => {
        const tree = renderer.create(
            <AutoArchiveProjectsAfterDays userId="user-1" autoArchiveProjectsAfterDays={undefined} />
        ).root
        const textValues = tree.findAllByType(Text).map(node => node.props.children)
        expect(textValues).toContain('30 days')
    })

    test('shows Never when automatic archival is disabled', () => {
        const tree = renderer.create(
            <AutoArchiveProjectsAfterDays userId="user-1" autoArchiveProjectsAfterDays={0} />
        ).root
        const textValues = tree.findAllByType(Text).map(node => node.props.children)
        expect(textValues).toContain('Never')
    })
})
