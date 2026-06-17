import React from 'react'
import renderer, { act } from 'react-test-renderer'

import MeetingBookingPage from './MeetingBookingPage'
import {
    bookPublicMeeting,
    getPublicBookingPage,
    getPublicBookingSlots,
} from '../../utils/backends/Booking/bookingFirestore'

jest.mock('expo-localization', () => ({
    locale: 'en',
}))

jest.mock('../UIControls/Button', () => {
    const React = require('react')
    const { Text, TouchableOpacity } = require('react-native')
    return props => (
        <TouchableOpacity testID={props.testID} onPress={props.onPress} disabled={props.disabled}>
            <Text>{props.processing ? props.processingTitle : props.title}</Text>
        </TouchableOpacity>
    )
})

jest.mock('../../utils/backends/Booking/bookingFirestore', () => ({
    bookPublicMeeting: jest.fn(),
    getPublicBookingPage: jest.fn(),
    getPublicBookingSlots: jest.fn(),
}))

const navigation = {
    getParam: key => (key === 'slug' ? 'karsten-wysk' : ''),
}

const page = {
    slug: 'karsten-wysk',
    profile: { displayName: 'Karsten Wysk', photoURL: '' },
    settings: {
        durationMinutes: 30,
        slotIntervalMinutes: 30,
        workingHoursStart: '09:00',
        workingHoursEnd: '17:00',
        includeWeekends: false,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        timeZone: 'Europe/Berlin',
    },
}

const flushPromises = () => new Promise(resolve => setImmediate(resolve))

describe('MeetingBookingPage', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        getPublicBookingPage.mockResolvedValue({ success: true, page })
        getPublicBookingSlots.mockResolvedValue({ success: true, timeZone: 'Europe/Berlin', options: [] })
        bookPublicMeeting.mockResolvedValue({
            success: true,
            bookingId: 'booking-1',
            start: '2026-06-18T09:00:00+02:00',
            end: '2026-06-18T09:30:00+02:00',
        })
    })

    test('renders the loading state before the page request resolves', () => {
        const tree = renderer.create(<MeetingBookingPage navigation={navigation} />)

        expect(tree.root.findAllByProps({ children: 'Loading booking page' }).length).toBeGreaterThan(0)
    })

    test('renders an empty slots state', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(<MeetingBookingPage navigation={navigation} />)
            await flushPromises()
            await flushPromises()
        })

        expect(tree.root.findAllByProps({ children: 'No times are available on this day.' }).length).toBeGreaterThan(0)
    })

    test('books a selected slot after visitor details are entered', async () => {
        const slot = { start: '2026-06-18T09:00:00+02:00', end: '2026-06-18T09:30:00+02:00' }
        getPublicBookingSlots.mockResolvedValue({ success: true, timeZone: 'Europe/Berlin', options: [slot] })
        let tree
        await act(async () => {
            tree = renderer.create(<MeetingBookingPage navigation={navigation} />)
            await flushPromises()
            await flushPromises()
        })

        await act(async () => {
            tree.root.findByProps({ testID: `booking-slot-${slot.start}` }).props.onPress()
            tree.root.findByProps({ testID: 'booking-name-input' }).props.onChangeText('Visitor')
            tree.root.findByProps({ testID: 'booking-email-input' }).props.onChangeText('visitor@example.com')
            await flushPromises()
        })

        await act(async () => {
            tree.root.findByProps({ testID: 'booking-confirm-button' }).props.onPress()
            await flushPromises()
        })

        expect(bookPublicMeeting).toHaveBeenCalledWith(
            expect.objectContaining({
                slug: 'karsten-wysk',
                start: slot.start,
                end: slot.end,
                visitorName: 'Visitor',
                visitorEmail: 'visitor@example.com',
            })
        )
        expect(tree.root.findAllByProps({ children: 'Meeting booked' }).length).toBeGreaterThan(0)
    })
})
