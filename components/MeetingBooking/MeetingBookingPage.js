import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import moment from 'moment-timezone'

import Button from '../UIControls/Button'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import {
    bookPublicMeeting,
    getPublicBookingPage,
    getPublicBookingSlots,
} from '../../utils/backends/Booking/bookingFirestore'

const PUBLIC_BOOKING_DAYS_TO_SHOW = 31

export default function MeetingBookingPage({ navigation }) {
    const slug = navigation.getParam('slug') || ''
    const [page, setPage] = useState(null)
    const [slots, setSlots] = useState([])
    const [selectedDay, setSelectedDay] = useState(null)
    const [selectedDuration, setSelectedDuration] = useState(30)
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
        return Array.from({ length: PUBLIC_BOOKING_DAYS_TO_SHOW }, (_, index) =>
            moment().tz(zone).add(index, 'days').startOf('day')
        )
    }, [timeZone])

    useEffect(() => {
        const loadPage = async () => {
            setLoadingPage(true)
            setError('')
            try {
                const result = await getPublicBookingPage(slug)
                setPage(result.page)
                const durations = result.page?.settings?.availableDurations || [30]
                setSelectedDuration(durations.includes(30) ? 30 : durations[0])
                setSelectedDay(
                    moment()
                        .tz(result.page?.settings?.timeZone || moment.tz.guess())
                        .startOf('day')
                )
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
                    durationMinutes: selectedDuration,
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
    }, [page, selectedDay, selectedDuration, slug, timeZone])

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
                durationMinutes: selectedDuration,
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
                <Text style={localStyles.successDescription}>{translate('Alldone booking success pitch')}</Text>
                <Button
                    title={translate('Try out alldone.app')}
                    type="secondary"
                    onPress={() => {
                        if (typeof window !== 'undefined') window.location.href = 'https://alldone.app'
                    }}
                    buttonStyle={localStyles.successButton}
                />
            </View>
        )
    }

    const availableDurations = page.settings.availableDurations || [page.settings.durationMinutes || 30]

    return (
        <ScrollView style={localStyles.page} contentContainerStyle={localStyles.content}>
            <View style={localStyles.header}>
                {!!page.profile?.photoURL && <Image source={page.profile.photoURL} style={localStyles.avatar} />}
                <View style={localStyles.headerText}>
                    <Text style={localStyles.title}>
                        {translate('Book a meeting with', { name: page.profile?.displayName })}
                    </Text>
                    <Text style={localStyles.meta}>
                        {selectedDuration} min · {timeZone}
                    </Text>
                </View>
            </View>

            <View style={localStyles.section}>
                <Text style={localStyles.sectionTitle}>{translate('Choose duration')}</Text>
                <View style={localStyles.durationRow}>
                    {availableDurations.map(duration => {
                        const active = selectedDuration === duration
                        return (
                            <TouchableOpacity
                                key={duration}
                                style={[localStyles.durationButton, active && localStyles.durationButtonActive]}
                                onPress={() => setSelectedDuration(duration)}
                            >
                                <Text style={[localStyles.durationText, active && localStyles.durationTextActive]}>
                                    {translate(`${duration} minute duration`)}
                                </Text>
                            </TouchableOpacity>
                        )
                    })}
                </View>
            </View>

            <View style={localStyles.section}>
                <Text style={localStyles.sectionTitle}>{translate('Choose a day')}</Text>
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={localStyles.dayList}
                >
                    {days.map(day => {
                        const active = selectedDay && day.isSame(selectedDay, 'day')
                        return (
                            <TouchableOpacity
                                key={day.format('YYYY-MM-DD')}
                                testID={`booking-day-${day.format('YYYY-MM-DD')}`}
                                style={[localStyles.dayButton, active && localStyles.dayButtonActive]}
                                onPress={() => setSelectedDay(day)}
                            >
                                <Text style={[localStyles.dayName, active && localStyles.dayTextActive]}>
                                    {day.format('ddd')}
                                </Text>
                                <Text style={[localStyles.dayNumber, active && localStyles.dayTextActive]}>
                                    {day.format('D')}
                                </Text>
                                <Text style={[localStyles.dayMonth, active && localStyles.dayTextActive]}>
                                    {day.format('MMM')}
                                </Text>
                            </TouchableOpacity>
                        )
                    })}
                </ScrollView>
            </View>

            <View style={localStyles.section}>
                <Text style={localStyles.sectionTitle}>{translate('Choose a time')}</Text>
                {loadingSlots ? (
                    <AvailabilityLoadingCard />
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

function AvailabilityLoadingCard() {
    const pulse = useRef(new Animated.Value(0)).current

    useEffect(() => {
        if (process.env.NODE_ENV === 'test') return undefined
        const animation = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, {
                    toValue: 1,
                    duration: 700,
                    useNativeDriver: true,
                }),
                Animated.timing(pulse, {
                    toValue: 0,
                    duration: 700,
                    useNativeDriver: true,
                }),
            ])
        )
        animation.start()
        return () => animation.stop()
    }, [pulse])

    const cardScale = pulse.interpolate({
        inputRange: [0, 1],
        outputRange: [0.985, 1],
    })
    const highlightOpacity = pulse.interpolate({
        inputRange: [0, 1],
        outputRange: [0.25, 0.75],
    })
    const secondDotOpacity = pulse.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [0.35, 1, 0.35],
    })
    const thirdDotOpacity = pulse.interpolate({
        inputRange: [0, 0.5, 1],
        outputRange: [0.2, 0.45, 1],
    })

    return (
        <Animated.View style={[localStyles.availabilityLoader, { transform: [{ scale: cardScale }] }]}>
            <View style={localStyles.loaderTimeline}>
                <Animated.View style={[localStyles.loaderNowMarker, { opacity: highlightOpacity }]} />
                <View style={localStyles.loaderHour} />
                <View style={[localStyles.loaderHour, localStyles.loaderHourShort]} />
                <View style={localStyles.loaderHour} />
            </View>
            <View style={localStyles.loaderTextArea}>
                <Text style={localStyles.loaderTitle}>{translate('Checking calendar availability')}</Text>
                <Text style={localStyles.loaderSubtitle}>{translate('Finding the best open slots')}</Text>
                <View style={localStyles.loaderDots}>
                    <Animated.View style={[localStyles.loaderDot, { opacity: highlightOpacity }]} />
                    <Animated.View style={[localStyles.loaderDot, { opacity: secondDotOpacity }]} />
                    <Animated.View style={[localStyles.loaderDot, { opacity: thirdDotOpacity }]} />
                </View>
            </View>
        </Animated.View>
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
    successDescription: {
        ...styles.body2,
        color: colors.Text02,
        textAlign: 'center',
        marginTop: 20,
        maxWidth: 420,
    },
    successButton: {
        marginTop: 16,
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
    dayMonth: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 1,
    },
    dayTextActive: {
        color: colors.Primary300,
    },
    durationRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginHorizontal: -4,
    },
    durationButton: {
        minWidth: 92,
        height: 40,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Grey300,
        alignItems: 'center',
        justifyContent: 'center',
        margin: 4,
        backgroundColor: '#FFFFFF',
    },
    durationButtonActive: {
        borderColor: colors.Primary300,
        backgroundColor: colors.Primary300,
    },
    durationText: {
        ...styles.subtitle2,
        color: colors.Text02,
    },
    durationTextActive: {
        color: '#FFFFFF',
    },
    slotGrid: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        marginHorizontal: -4,
    },
    availabilityLoader: {
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 112,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.Grey300,
        backgroundColor: '#FFFFFF',
        padding: 16,
    },
    loaderTimeline: {
        width: 76,
        height: 76,
        borderRadius: 6,
        backgroundColor: '#F7F8FA',
        padding: 10,
        justifyContent: 'space-between',
        marginRight: 16,
        overflow: 'hidden',
    },
    loaderNowMarker: {
        position: 'absolute',
        top: 31,
        left: 8,
        right: 8,
        height: 14,
        borderRadius: 7,
        backgroundColor: colors.Primary300,
    },
    loaderHour: {
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.Grey300,
    },
    loaderHourShort: {
        width: '62%',
    },
    loaderTextArea: {
        flex: 1,
    },
    loaderTitle: {
        ...styles.subtitle1,
        color: colors.Text01,
    },
    loaderSubtitle: {
        ...styles.body2,
        color: colors.Text03,
        marginTop: 4,
    },
    loaderDots: {
        flexDirection: 'row',
        marginTop: 12,
    },
    loaderDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        backgroundColor: colors.Primary300,
        marginRight: 6,
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
