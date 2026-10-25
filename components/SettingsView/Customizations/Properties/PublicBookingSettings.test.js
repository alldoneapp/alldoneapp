import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { TextInput } from 'react-native'

import PublicBookingSettings from './PublicBookingSettings'
import { getBookingSettings } from '../../../../utils/backends/Booking/bookingFirestore'

jest.mock('../../../UIControls/Button', () => 'MockButton')
jest.mock('../../../UIControls/Switch', () => 'MockSwitch')
jest.mock('../../../UIComponents/Spinner', () => 'MockSpinner')
jest.mock('../../../styles/global', () => ({
    __esModule: true,
    default: { body2: {}, caption2: {}, title6: {} },
    colors: {
        Grey300: '#ddd',
        Text01: '#111',
        Text02: '#222',
        Text03: '#333',
        UtilityGreen200: '#080',
        UtilityRed200: '#f00',
    },
}))
jest.mock('../../../../utils/HelperFunctions', () => ({ copyTextToClipboard: jest.fn() }))
jest.mock('../../../../utils/backends/Booking/bookingFirestore', () => ({
    getBookingSettings: jest.fn(),
    saveBookingSettings: jest.fn(),
}))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: value => value }))

const findByTestId = (tree, testID) => tree.root.find(node => node.props.testID === testID)

describe('PublicBookingSettings loading state', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('keeps the section visible but dimmed and disabled behind a spinner while loading', () => {
        getBookingSettings.mockReturnValue(new Promise(() => {}))

        let tree
        act(() => {
            tree = renderer.create(<PublicBookingSettings />)
        })

        const content = findByTestId(tree, 'public-booking-settings-content')
        const spinnerOverlay = findByTestId(tree, 'public-booking-settings-spinner')

        expect(content.props.pointerEvents).toBe('none')
        expect(JSON.stringify(content.props.style)).toContain('0.4')
        expect(
            tree.root.findAllByType('MockButton').some(button => button.props.title === 'Save booking settings')
        ).toBe(true)
        expect(spinnerOverlay.props.accessibilityRole).toBe('progressbar')
        expect(spinnerOverlay.props.accessibilityLabel).toBe('Loading booking settings')
        expect(tree.root.findByType('MockSpinner').props).toMatchObject({
            containerSize: 64,
            spinnerSize: 40,
            containerColor: '#ddd',
        })
    })

    test('restores interaction and removes the spinner after settings load', async () => {
        getBookingSettings.mockResolvedValue({
            settings: { slug: 'team-demo' },
            publicUrl: 'https://my.alldone.app/meet/team-demo',
            connectedCalendarCount: 1,
        })

        let tree
        await act(async () => {
            tree = renderer.create(<PublicBookingSettings />)
        })

        const content = findByTestId(tree, 'public-booking-settings-content')
        expect(content.props.pointerEvents).toBe('auto')
        expect(content.props.style).toBe(false)
        expect(tree.root.findAll(node => node.props.testID === 'public-booking-settings-spinner')).toHaveLength(0)
        expect(tree.root.findAllByType(TextInput).some(input => input.props.value === 'team-demo')).toBe(true)
    })
})
