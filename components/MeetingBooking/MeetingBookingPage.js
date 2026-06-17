import React, { useEffect, useMemo, useState } from 'react'
import { Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import moment from 'moment-timezone'

import Button from '../UIControls/Button'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import {
    bookPublicMeeting,
    getPublicBookingPage,
    getPublicBookingSlots,
} from '../../utils/backends/Booking/bookingFirestore'

export default function MeetingBookingPage({ navigation }) {
    const slug = navigation.getParam('slug') || ''
    const [page, setPage] = useState(null)
    const [slots, setSlots] = useState([])
    const [selectedDay, setSelectedDay] = useState(null)
    const [selectedSlot, setSelectedSlot] = useState(null)
    const [visitorName, setVisitorName] = useState('')
    const [visitorEmail, setVisitorEmail] = useState('')
    const [note, setNote] = useState('')
    const [loadingPage, setLoadingPage] = useState(true)
    const [loadingSlots, setLoadingSlots] = useState(false)
    const [booking, setBooking] = useState(false)
    const [error, setError] = useState('')
    const [success, setSuccess] = useState(null)

    const timeZone = page?.settings?.timeZone || moment.tz.guess()
    const days = useMemo(() => {
        const zone = timeZone || moment.tz.guess()
        return Array.from({ length: 7 }, (_, index) => moment().tz(zone).add(index, 'days').startOf('day'))
    }, [timeZone])

    useEffect(() => {
        const loadPage = async () => {
            setLoadingPage(true)
            setError('')
            try {
                const result = await getPublicBookingPage(slug)
                setPage(result.page)
                setSelectedDay(moment().tz(result.page?.settings?.timeZone || moment.tz.guess()).startOf('day'))
                if (typeof document !== 'undefined') {
                    document.title = translate('Book a meeting document title', {
                        name: result.page?.profile?.displayName || 'Alldone',
                    })
                }
            } catch (loadError) {
                setError(loadError.message || translate('Booking page not found'))
            } finally {
                setLoadingPage(false)
            }
        }
        loadPage()
    }, [slug])

    useEffect(() => {
        if (!page || !selectedDay) return
        const loadSlots = async () => {
            setLoadingSlots(true)
            setSelectedSlot(null)
            setError('')
            try {
                const result = await getPublicBookingSlots({
                    slug,
                    start: selectedDay.clone().tz(timeZone).startOf('day').format(),
                    end: selectedDay.clone().tz(timeZone).endOf('day').format(),
                    timeZone,
                })
                setSlots(result.options || [])
            } catch (slotsError) {
                setSlots([])
                setError(slotsError.message || translate('Could not load available times'))
            } finally {
                setLoadingSlots(false)
            }
        }
        loadSlots()
    }, [page, selectedDay, slug, timeZone])

    const onBook = async () => {
        if (!selectedSlot) {
            setError(translate('Choose a time first'))
            return
        }
        if (!visitorName.trim() || !visitorEmail.trim()) {
            setError(translate('Enter your name and email'))
            return
        }

        setBooking(true)
        setError('')
        try {
            const result = await bookPublicMeeting({
                slug,
                start: selectedSlot.start,
                end: selectedSlot.end,
                timeZone,
                visitorName,
                visitorEmail,
                note,
            })
            setSuccess(result)
        } catch (bookError) {
            setError(bookError.message || translate('Could not book this meeting'))
        } finally {
            setBooking(false)
        }
    }

    if (loadingPage) {
        return (
            <View style={localStyles.centered}>
                <Text style={localStyles.meta}>{translate('Loading booking page')}</Text>
            </View>
        )
    }

    if (!page || error === translate('Booking page not found')) {
        return (
            <View style={localStyles.centered}>
                <Text style={localStyles.title}>{translate('Booking page unavailable')}</Text>
                <Text style={localStyles.meta}>{error || translate('This booking link is not active.')}</Text>
            </View>
        )
    }

    if (success) {
        return (
            <View style={localStyles.centered}>
                <Text style={localStyles.title}>{translate('Meeting booked')}</Text>
                <Text style={localStyles.meta}>
                    {moment(success.start).tz(timeZone).format('dddd, MMM D [at] HH:mm')} {timeZone}
                </Text>
            </View>
        )
    }

    return (
        <ScrollView style={localStyles.page} contentContainerStyle={localStyles.content}>
            <View style={localStyles.header}>
                {!!page.profile?.photoURL && <Image source={page.profile.photoURL} style={localStyles.avatar} />}
                <View style={localStyles.headerText}>
                    <Text style={localStyles.title}>
                        {translate('Book a meeting with', { name: page.profile?.displayName })}
                    </Text>
                    <Text style={localStyles.meta}>
                        {page.settings.durationMinutes} min · {timeZone}
                    </Text>
                </View>
            </View>

            <View style={localStyles.section}>
                <Text style={localStyles.sectionTitle}>{translate('Choose a day')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={localStyles.dayList}>
                    {days.map(day => {
                        const active = selectedDay && day.isSame(selectedDay, 'day')
                        return (
                            <TouchableOpacity
                                key={day.format('YYYY-MM-DD')}
                                style={[localStyles.dayButton, active && localStyles.dayButtonActive]}
                                onPress={() => setSelectedDay(day)}
                            >
                                <Text style={[localStyles.dayName, active && localStyles.dayTextActive]}>
                                    {day.format('ddd')}
                                </Text>
                                <Text style={[localStyles.dayNumber, active && localStyles.dayTextActive]}>
                                    {day.format('D')}
                                </Text>
                            </TouchableOpacity>
                        )
                    })}
                </ScrollView>
            </View>

            <View style={localStyles.section}>
                <Text style={localStyles.sectionTitle}>{translate('Choose a time')}</Text>
                {loadingSlots ? (
                    <Text style={localStyles.meta}>{translate('Loading available times')}</Text>
                ) : slots.length === 0 ? (
                    <Text style={localStyles.meta}>{translate('No times are available on this day.')}</Text>
                ) : (
                    <View style={localStyles.slotGrid}>
                        {slots.map(slot => {
                            const active = selectedSlot?.start === slot.start
                            return (
                                <TouchableOpacity
                                    key={slot.start}
                                    testID={`booking-slot-${slot.start}`}
                                    style={[localStyles.slotButton, active && localStyles.slotButtonActive]}
                                    onPress={() => setSelectedSlot(slot)}
                                >
                                    <Text style={[localStyles.slotText, active && localStyles.slotTextActive]}>
                                        {moment(slot.start).tz(timeZone).format('HH:mm')}
                                    </Text>
                                </TouchableOpacity>
                            )
                        })}
                    </View>
                )}
            </View>

            <View style={localStyles.section}>
                <Text style={localStyles.sectionTitle}>{translate('Your details')}</Text>
                <TextInput
                    testID="booking-name-input"
                    value={visitorName}
                    onChangeText={setVisitorName}
                    placeholder={translate('Name')}
                    style={localStyles.input}
                />
                <TextInput
                    testID="booking-email-input"
                    value={visitorEmail}
                    onChangeText={setVisitorEmail}
                    placeholder={translate('Email')}
                    style={localStyles.input}
                    autoCapitalize="none"
                />
                <TextInput
                    testID="booking-note-input"
                    value={note}
                    onChangeText={setNote}
                    placeholder={translate('Optional note')}
                    style={[localStyles.input, localStyles.noteInput]}
                    multiline
                />
            </View>

            {!!error && <Text style={localStyles.error}>{error}</Text>}
            <Button
                testID="booking-confirm-button"
                title={translate('Confirm meeting')}
                onPress={onBook}
                processing={booking}
                processingTitle={translate('Booking')}
                disabled={booking}
                buttonStyle={localStyles.confirmButton}
            />
        </ScrollView>
    )
}

const localStyles = StyleSheet.create({
    page: {
        flex: 1,
        backgroundColor: '#F7F8FA',
    },
    content: {
        width: '100%',
        maxWidth: 760,
        alignSelf: 'center',
        padding: 24,
    },
    centered: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        backgroundColor: '#F7F8FA',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 24,
    },
    avatar: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: colors.Text03,
        marginRight: 16,
    },
    headerText: {
        flex: 1,
    },
    title: {
        ...styles.title5,
        color: colors.Text01,
    },
    meta: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 4,
    },
    section: {
        marginTop: 20,
    },
    sectionTitle: {
        ...styles.subtitle1,
        color: colors.Text01,
        marginBottom: 10,
    },
    dayList: {
        paddingVertical: 2,
    },
    dayButton: {
        width: 68,
        height: 72,
        borderWidth: 1,
        borderColor: colors.Grey300,
        borderRadius: 6,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
        backgroundColor: '#FFFFFF',
    },
    dayButtonActive: {
        borderColor: colors.Primary300,
        backgroundColor: colors.Primary100,
    },
    dayName: {
        ...styles.caption2,
        color: colors.Text03,
    },
    dayNumber: {
        ...styles.title6,
        color: colors.Text01,
        marginTop: 3,
    },
    dayTextActive: {
        color: colors.Primary300,
    },
    slotGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginHorizontal: -4,
    },
    slotButton: {
        width: 96,
        height: 40,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Grey300,
        alignItems: 'center',
        justifyContent: 'center',
        margin: 4,
        backgroundColor: '#FFFFFF',
    },
    slotButtonActive: {
        borderColor: colors.Primary300,
        backgroundColor: colors.Primary300,
    },
    slotText: {
        ...styles.subtitle2,
        color: colors.Text02,
    },
    slotTextActive: {
        color: '#FFFFFF',
    },
    input: {
        height: 44,
        borderWidth: 1,
        borderColor: colors.Grey300,
        borderRadius: 4,
        paddingHorizontal: 12,
        marginBottom: 10,
        backgroundColor: '#FFFFFF',
        color: colors.Text01,
    },
    noteInput: {
        minHeight: 88,
        paddingTop: 10,
    },
    error: {
        ...styles.body2,
        color: colors.UtilityRed200,
        marginTop: 12,
    },
    confirmButton: {
        alignSelf: 'flex-start',
        marginTop: 16,
    },
})
