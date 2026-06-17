import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Animated, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import moment from 'moment-timezone'

import Button from '../UIControls/Button'
import styles, { colors } from '../styles/global'
import { getDeviceLanguage, translate } from '../../i18n/TranslationService'
import {
    bookPublicMeeting,
    getPublicBookingPage,
    getPublicBookingSlots,
} from '../../utils/backends/Booking/bookingFirestore'

const PUBLIC_BOOKING_DAYS_TO_SHOW = 31

function formatZoneLabel(zone) {
    if (!zone) return ''
    const offset = moment.tz(zone).format('Z')
    const friendly = zone.replace(/_/g, ' ')
    return `${friendly} (GMT${offset})`
}

function getFirstName(name) {
    return String(name || '')
        .trim()
        .split(/\s+/)[0]
}

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
    const [displayTimeZone, setDisplayTimeZone] = useState(null)
    const [pickerOpen, setPickerOpen] = useState(false)

    // The host's timezone drives availability (working hours + day boundaries) and is
    // always sent to the backend. The visitor's timezone is the default for display so
    // they see times in their own local time. They can switch the display to the host's.
    const visitorTimeZone = useMemo(() => moment.tz.guess() || 'UTC', [])
    const hostTimeZone = page?.settings?.timeZone || visitorTimeZone
    const activeTimeZone = displayTimeZone || visitorTimeZone

    const days = useMemo(() => {
        return Array.from({ length: PUBLIC_BOOKING_DAYS_TO_SHOW }, (_, index) =>
            moment().tz(hostTimeZone).add(index, 'days').startOf('day')
        )
    }, [hostTimeZone])

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
                const now = moment().tz(hostTimeZone)
                const dayStart = selectedDay.clone().tz(hostTimeZone).startOf('day')
                // For today, start from the current time so past slots aren't offered.
                const start = dayStart.isSame(now, 'day') && now.isAfter(dayStart) ? now : dayStart
                const result = await getPublicBookingSlots({
                    slug,
                    start: start.format(),
                    end: selectedDay.clone().tz(hostTimeZone).endOf('day').format(),
                    timeZone: hostTimeZone,
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
    }, [page, selectedDay, selectedDuration, slug, hostTimeZone])

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
                timeZone: hostTimeZone,
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
        return <BookingPageSkeleton />
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
        const when = moment(success.start).tz(activeTimeZone).locale(getDeviceLanguage())
        return (
            <View style={localStyles.centered}>
                <View style={localStyles.successCard}>
                    <View style={localStyles.successBadge}>
                        <Text style={localStyles.successBadgeCheck}>✓</Text>
                    </View>
                    <Text style={localStyles.successTitle}>{translate('Meeting booked')}</Text>
                    <View style={localStyles.successWhen}>
                        <Text style={localStyles.successWhenDate}>{when.format('dddd, D MMMM')}</Text>
                        <Text style={localStyles.successWhenTime}>{when.format('HH:mm')}</Text>
                        <Text style={localStyles.successWhenZone}>{formatZoneLabel(activeTimeZone)}</Text>
                    </View>
                    <Text style={localStyles.successDescription}>{translate('Alldone booking success pitch')}</Text>
                    <Button
                        title={translate('Try out alldone.app')}
                        onPress={() => {
                            if (typeof window !== 'undefined') window.location.href = 'https://alldone.app'
                        }}
                        buttonStyle={localStyles.successButton}
                    />
                </View>
            </View>
        )
    }

    const availableDurations = page.settings.availableDurations || [page.settings.durationMinutes || 30]

    return (
        <View style={localStyles.root}>
            <ScrollView style={localStyles.page} contentContainerStyle={localStyles.content}>
                <View style={localStyles.header}>
                    {!!page.profile?.photoURL && <Image source={page.profile.photoURL} style={localStyles.avatar} />}
                    <View style={localStyles.headerText}>
                        <Text style={localStyles.title}>
                            {translate('Book a meeting with', { name: page.profile?.displayName })}
                        </Text>
                        <Text style={localStyles.meta}>{selectedDuration} min</Text>
                    </View>
                </View>

                <View style={localStyles.timeZoneBar}>
                    <Text style={localStyles.timeZoneLabel}>{translate('Times shown in')}</Text>
                    <TouchableOpacity
                        testID="booking-timezone-select"
                        style={localStyles.timeZoneSelect}
                        onPress={() => setPickerOpen(true)}
                    >
                        <Text style={localStyles.timeZoneSelectText}>{formatZoneLabel(activeTimeZone)}</Text>
                        <Text style={localStyles.timeZoneCaret}>▾</Text>
                    </TouchableOpacity>
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
                                const slotMoment = moment(slot.start).tz(activeTimeZone)
                                // When the display timezone shifts a slot onto a different calendar
                                // day than the selected (host) day, show the date so it isn't misread.
                                const crossesDay = slotMoment.format('YYYY-MM-DD') !== selectedDay.format('YYYY-MM-DD')
                                return (
                                    <TouchableOpacity
                                        key={slot.start}
                                        testID={`booking-slot-${slot.start}`}
                                        style={[localStyles.slotButton, active && localStyles.slotButtonActive]}
                                        onPress={() => setSelectedSlot(slot)}
                                    >
                                        <Text style={[localStyles.slotText, active && localStyles.slotTextActive]}>
                                            {slotMoment.format('HH:mm')}
                                        </Text>
                                        {crossesDay && (
                                            <Text style={[localStyles.slotDate, active && localStyles.slotTextActive]}>
                                                {slotMoment.format('MMM D')}
                                            </Text>
                                        )}
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
            {pickerOpen && (
                <TimeZonePicker
                    activeTimeZone={activeTimeZone}
                    visitorTimeZone={visitorTimeZone}
                    hostTimeZone={hostTimeZone}
                    hostName={getFirstName(page.profile?.displayName)}
                    onSelect={zone => {
                        setDisplayTimeZone(zone)
                        setPickerOpen(false)
                    }}
                    onClose={() => setPickerOpen(false)}
                />
            )}
        </View>
    )
}

const MAX_TIMEZONE_RESULTS = 60

function TimeZonePicker({ activeTimeZone, visitorTimeZone, hostTimeZone, hostName, onSelect, onClose }) {
    const [query, setQuery] = useState('')

    const allZones = useMemo(() => moment.tz.names(), [])
    const normalizedQuery = query.trim().toLowerCase()
    const filteredZones = useMemo(() => {
        if (!normalizedQuery) return allZones
        return allZones.filter(zone => zone.toLowerCase().replace(/_/g, ' ').includes(normalizedQuery))
    }, [allZones, normalizedQuery])
    const visibleZones = filteredZones.slice(0, MAX_TIMEZONE_RESULTS)
    const hiddenCount = filteredZones.length - visibleZones.length

    const quickOptions = []
    quickOptions.push({ zone: visitorTimeZone, label: translate('Your time') })
    if (hostTimeZone !== visitorTimeZone) {
        quickOptions.push({ zone: hostTimeZone, label: translate('Host time', { name: hostName }) })
    }

    const renderZoneRow = (zone, hint) => {
        const active = zone === activeTimeZone
        return (
            <TouchableOpacity
                key={`${hint || 'zone'}-${zone}`}
                testID={`booking-timezone-option-${zone}`}
                style={[localStyles.pickerRow, active && localStyles.pickerRowActive]}
                onPress={() => onSelect(zone)}
            >
                <Text style={[localStyles.pickerRowText, active && localStyles.pickerRowTextActive]} numberOfLines={1}>
                    {formatZoneLabel(zone)}
                </Text>
                <View style={localStyles.pickerRowRight}>
                    {!!hint && (
                        <Text style={[localStyles.pickerRowHint, active && localStyles.pickerRowHintActive]}>
                            {hint}
                        </Text>
                    )}
                    {active && <Text style={localStyles.pickerRowCheck}>✓</Text>}
                </View>
            </TouchableOpacity>
        )
    }

    return (
        <View style={localStyles.pickerOverlay}>
            <TouchableOpacity style={localStyles.pickerBackdrop} activeOpacity={1} onPress={onClose} />
            <View style={localStyles.pickerCard}>
                <View style={localStyles.pickerHeader}>
                    <Text style={localStyles.pickerTitle}>{translate('Select timezone')}</Text>
                    <TouchableOpacity testID="booking-timezone-close" onPress={onClose} style={localStyles.pickerClose}>
                        <Text style={localStyles.pickerCloseText}>✕</Text>
                    </TouchableOpacity>
                </View>
                <TextInput
                    testID="booking-timezone-search"
                    value={query}
                    onChangeText={setQuery}
                    placeholder={translate('Search timezone')}
                    placeholderTextColor={colors.Text03}
                    style={localStyles.pickerSearch}
                    autoFocus
                />
                <ScrollView style={localStyles.pickerList} keyboardShouldPersistTaps="handled">
                    {!normalizedQuery && quickOptions.map(option => renderZoneRow(option.zone, option.label))}
                    {!normalizedQuery && <View style={localStyles.pickerDivider} />}
                    {visibleZones.map(zone => renderZoneRow(zone))}
                    {hiddenCount > 0 && (
                        <Text style={localStyles.pickerHint}>
                            {translate('Refine search to see more timezones', { count: hiddenCount })}
                        </Text>
                    )}
                    {filteredZones.length === 0 && (
                        <Text style={localStyles.pickerHint}>{translate('No timezones match your search')}</Text>
                    )}
                </ScrollView>
            </View>
        </View>
    )
}

function useShimmer() {
    const pulse = useRef(new Animated.Value(0)).current

    useEffect(() => {
        if (process.env.NODE_ENV === 'test') return undefined
        const animation = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, { toValue: 1, duration: 850, useNativeDriver: true }),
                Animated.timing(pulse, { toValue: 0, duration: 850, useNativeDriver: true }),
            ])
        )
        animation.start()
        return () => animation.stop()
    }, [pulse])

    return pulse
}

function SkeletonBlock({ style, opacity }) {
    return <Animated.View style={[localStyles.skeletonBlock, style, { opacity }]} />
}

function BookingPageSkeleton() {
    const pulse = useShimmer()
    const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] })

    return (
        <ScrollView
            testID="booking-loading-skeleton"
            style={localStyles.page}
            contentContainerStyle={localStyles.content}
        >
            <View style={localStyles.skeletonHeader}>
                <SkeletonBlock style={localStyles.skeletonAvatar} opacity={opacity} />
                <View style={localStyles.skeletonHeaderText}>
                    <SkeletonBlock style={localStyles.skeletonTitleLine} opacity={opacity} />
                    <SkeletonBlock style={localStyles.skeletonMetaLine} opacity={opacity} />
                </View>
            </View>

            <View style={localStyles.section}>
                <SkeletonBlock style={localStyles.skeletonSectionTitle} opacity={opacity} />
                <View style={localStyles.durationRow}>
                    {[0, 1, 2].map(index => (
                        <SkeletonBlock key={index} style={localStyles.skeletonDuration} opacity={opacity} />
                    ))}
                </View>
            </View>

            <View style={localStyles.section}>
                <SkeletonBlock style={localStyles.skeletonSectionTitle} opacity={opacity} />
                <View style={localStyles.skeletonDayRow}>
                    {[0, 1, 2, 3, 4, 5].map(index => (
                        <SkeletonBlock key={index} style={localStyles.skeletonDay} opacity={opacity} />
                    ))}
                </View>
            </View>

            <View style={localStyles.section}>
                <SkeletonBlock style={localStyles.skeletonSectionTitle} opacity={opacity} />
                <AvailabilityLoadingCard />
            </View>
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
    successCard: {
        width: '100%',
        maxWidth: 460,
        alignItems: 'center',
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        paddingVertical: 40,
        paddingHorizontal: 32,
        shadowColor: '#000000',
        shadowOpacity: 0.08,
        shadowRadius: 28,
        shadowOffset: { width: 0, height: 12 },
    },
    successBadge: {
        width: 64,
        height: 64,
        borderRadius: 32,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.UtilityGreen100,
        marginBottom: 20,
    },
    successBadgeCheck: {
        fontSize: 32,
        lineHeight: 38,
        color: colors.UtilityGreen200,
    },
    successTitle: {
        ...styles.title4,
        color: colors.Text01,
        textAlign: 'center',
    },
    successWhen: {
        alignItems: 'center',
        alignSelf: 'stretch',
        marginTop: 20,
        paddingVertical: 16,
        paddingHorizontal: 20,
        borderRadius: 12,
        backgroundColor: colors.UtilityBlue,
    },
    successWhenDate: {
        ...styles.subtitle1,
        color: colors.Primary300,
        textAlign: 'center',
    },
    successWhenTime: {
        ...styles.title4,
        color: colors.Text01,
        marginTop: 2,
    },
    successWhenZone: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 4,
        textAlign: 'center',
    },
    successDescription: {
        ...styles.body2,
        color: colors.Text02,
        textAlign: 'center',
        marginTop: 24,
        maxWidth: 360,
    },
    successButton: {
        alignSelf: 'center',
        marginTop: 24,
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
        borderColor: colors.Primary100,
        backgroundColor: colors.UtilityBlue,
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
    timeZoneBar: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.Grey300,
        backgroundColor: '#FFFFFF',
        marginBottom: 4,
    },
    timeZoneLabel: {
        ...styles.body2,
        color: colors.Text02,
        marginRight: 12,
    },
    timeZoneSelect: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.Primary100,
        backgroundColor: colors.UtilityBlue,
        flexShrink: 1,
    },
    timeZoneSelectText: {
        ...styles.subtitle2,
        color: colors.Primary300,
        marginRight: 8,
    },
    timeZoneCaret: {
        ...styles.caption2,
        color: colors.Primary300,
    },
    root: {
        flex: 1,
    },
    pickerOverlay: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        zIndex: 1000,
    },
    pickerBackdrop: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.35)',
    },
    pickerCard: {
        width: '100%',
        maxWidth: 440,
        maxHeight: 520,
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        padding: 20,
        shadowColor: '#000000',
        shadowOpacity: 0.2,
        shadowRadius: 32,
        shadowOffset: { width: 0, height: 16 },
    },
    pickerHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 16,
    },
    pickerTitle: {
        ...styles.title5,
        color: colors.Text01,
    },
    pickerClose: {
        width: 32,
        height: 32,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.Grey200,
    },
    pickerCloseText: {
        ...styles.subtitle2,
        color: colors.Text02,
    },
    pickerSearch: {
        height: 44,
        borderWidth: 1,
        borderColor: colors.Grey300,
        borderRadius: 8,
        paddingHorizontal: 14,
        color: colors.Text01,
        backgroundColor: colors.Grey100,
        marginBottom: 12,
    },
    pickerList: {
        flexGrow: 0,
    },
    pickerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        minHeight: 44,
        paddingVertical: 10,
        paddingHorizontal: 12,
        borderRadius: 8,
    },
    pickerRowActive: {
        backgroundColor: colors.UtilityBlue,
    },
    pickerRowText: {
        ...styles.body2,
        color: colors.Text01,
        flexShrink: 1,
    },
    pickerRowTextActive: {
        ...styles.subtitle2,
        color: colors.Primary300,
    },
    pickerRowRight: {
        flexDirection: 'row',
        alignItems: 'center',
        marginLeft: 12,
    },
    pickerRowHint: {
        ...styles.caption2,
        color: colors.Text02,
        backgroundColor: colors.Grey200,
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 10,
        overflow: 'hidden',
    },
    pickerRowHintActive: {
        color: '#FFFFFF',
        backgroundColor: colors.Primary100,
    },
    pickerRowCheck: {
        ...styles.subtitle1,
        color: colors.Primary100,
        marginLeft: 10,
    },
    pickerDivider: {
        height: 1,
        backgroundColor: colors.Grey300,
        marginVertical: 8,
    },
    pickerHint: {
        ...styles.caption2,
        color: colors.Text03,
        paddingVertical: 10,
        paddingHorizontal: 12,
    },
    slotDate: {
        ...styles.caption2,
        color: colors.Text03,
        marginTop: 2,
    },
    skeletonBlock: {
        backgroundColor: colors.Grey300,
        borderRadius: 6,
    },
    skeletonHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 24,
    },
    skeletonAvatar: {
        width: 64,
        height: 64,
        borderRadius: 32,
        marginRight: 16,
    },
    skeletonHeaderText: {
        flex: 1,
    },
    skeletonTitleLine: {
        height: 22,
        width: '70%',
        borderRadius: 5,
    },
    skeletonMetaLine: {
        height: 14,
        width: '40%',
        borderRadius: 4,
        marginTop: 10,
    },
    skeletonSectionTitle: {
        height: 16,
        width: 140,
        borderRadius: 4,
        marginBottom: 12,
    },
    skeletonDuration: {
        width: 92,
        height: 40,
        borderRadius: 4,
        margin: 4,
    },
    skeletonDayRow: {
        flexDirection: 'row',
    },
    skeletonDay: {
        width: 68,
        height: 72,
        borderRadius: 6,
        marginRight: 8,
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
        borderColor: colors.Primary100,
        backgroundColor: colors.UtilityBlue,
    },
    durationText: {
        ...styles.subtitle2,
        color: colors.Text02,
    },
    durationTextActive: {
        color: colors.Primary300,
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
        minHeight: 40,
        paddingVertical: 4,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Grey300,
        alignItems: 'center',
        justifyContent: 'center',
        margin: 4,
        backgroundColor: '#FFFFFF',
    },
    slotButtonActive: {
        borderColor: colors.Primary100,
        backgroundColor: colors.UtilityBlue,
    },
    slotText: {
        ...styles.subtitle2,
        color: colors.Text02,
    },
    slotTextActive: {
        color: colors.Primary300,
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
