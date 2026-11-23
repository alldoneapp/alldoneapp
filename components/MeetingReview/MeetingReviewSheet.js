import React, { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../styles/global'
import { themed } from '../../Themes/colorMode'
import { translate } from '../../i18n/TranslationService'
import useEscapeKey from '../../hooks/useEscapeKey'
import {
    MEETING_CATEGORIES,
    MEETING_CATEGORY_COLORS,
    MEETING_CATEGORY_HINT_KEYS,
    MEETING_CATEGORY_LABEL_KEYS,
    MEETING_CONFIDENCE_LOW,
    MEETING_CONFIDENCE_MEDIUM,
    MEETING_USEFULNESS_EMOJI,
    MEETING_USEFULNESS_LABEL_KEYS,
    MEETING_USEFULNESS_LEVELS,
    MEETING_ATTENDANCE_NOT_ATTENDED,
    MEETING_REVIEW_STATUS_RATED,
} from '../../functions/shared/meetingReview/meetingReviewConstants'
import { getDefaultSeriesScope } from '../../functions/shared/meetingReview/meetingCategorySuggestion'
import { getCalendarEventBounds } from '../../functions/shared/meetingReview/calendarEventCounting'
import { formatMeetingDuration, formatMeetingTime } from '../../utils/meetingReview/meetingReviewFormat'
import { localizedMoment } from '../../i18n/localizedMoment'

const MIN = 60 * 1000

const SOURCE_LABEL_KEYS = {
    series: 'Meeting suggestion source series',
    rule: 'Meeting suggestion source rule',
    ai: 'Meeting suggestion source ai',
    heuristic: 'Meeting suggestion source signals',
}

const isTypingTarget = target => {
    if (!target) return false
    const tagName = String(target.tagName || '').toLowerCase()
    return tagName === 'input' || tagName === 'textarea' || target.isContentEditable
}

export const getSuggestionLabel = resolved => {
    if (!resolved || resolved.confirmed || !resolved.source) return ''
    const source = SOURCE_LABEL_KEYS[resolved.source] ? translate(SOURCE_LABEL_KEYS[resolved.source]) : ''
    const base =
        resolved.confidence === MEETING_CONFIDENCE_MEDIUM
            ? translate('Meeting suggestion uncertain')
            : resolved.confidence === MEETING_CONFIDENCE_LOW
              ? translate('Meeting suggestion please choose')
              : translate('Meeting suggestion')
    return source ? `${base} · ${source}` : base
}

/**
 * AT-3137 — the rating sheet (concept W1–W4, W10). Content only; MeetingReviewHost places it.
 *
 * One tap on a usefulness button saves the rating AND confirms a preselected category. Nothing is
 * ever preselected for the usefulness. "Later", Escape or × leave the appointment unrated (the task
 * stays done). With low confidence no category is preselected; a usefulness tap then leaves the
 * category open.
 *
 * Keyboard (web): 1/2/3 = usefulness, K = category list, D = duration, Esc = later.
 */
export default function MeetingReviewSheet({
    task,
    review,
    resolved,
    seriesCategory,
    isEdit = false,
    queueRemaining = 0,
    saving = false,
    nowMs = Date.now(),
    timeFormat = 'HH:mm',
    onAction,
    onLater,
    onStartQueue,
    onOpenStatistics,
}) {
    const bounds = getCalendarEventBounds(task.calendarData) || { startMs: 0, endMs: 0 }
    const seriesId = task.calendarData?.recurringEventId || null
    const initialCategory = resolved?.confirmed || resolved?.preselected ? resolved.category : null

    const [selectedCategory, setSelectedCategory] = useState(initialCategory)
    const [userPickedCategory, setUserPickedCategory] = useState(false)
    const [showCategoryList, setShowCategoryList] = useState(!initialCategory)
    const [scope, setScope] = useState(getDefaultSeriesScope({ recurringEventId: seriesId, seriesCategory }))
    const [showWhy, setShowWhy] = useState(false)
    const [showDuration, setShowDuration] = useState(false)
    const plannedStart = bounds.startMs
    const plannedEnd = bounds.endMs
    const [durationStart, setDurationStart] = useState(
        Number.isFinite(review?.actualStartMs) ? review.actualStartMs : plannedStart
    )
    const [durationEnd, setDurationEnd] = useState(
        Number.isFinite(review?.actualEndMs) ? review.actualEndMs : plannedEnd
    )
    const durationChanged =
        durationStart !== (Number.isFinite(review?.actualStartMs) ? review.actualStartMs : plannedStart) ||
        durationEnd !== (Number.isFinite(review?.actualEndMs) ? review.actualEndMs : plannedEnd)

    const pendingDuration = durationChanged ? { actualStartMs: durationStart, actualEndMs: durationEnd } : null
    const isRated = review?.reviewStatus === MEETING_REVIEW_STATUS_RATED
    const notAttended = review?.attendance === MEETING_ATTENDANCE_NOT_ATTENDED

    const candidates = useMemo(() => (resolved?.preselected ? [] : resolved?.candidates || []), [resolved])

    const pickCategory = category => {
        setSelectedCategory(category)
        setUserPickedCategory(true)
        setShowCategoryList(false)
    }

    const rate = usefulness => {
        if (saving) return
        onAction(
            {
                type: 'rate',
                usefulness,
                category: userPickedCategory ? selectedCategory : undefined,
            },
            { scope: userPickedCategory ? scope : null, duration: pendingDuration }
        )
    }

    const later = () => {
        if (saving) return
        if (userPickedCategory && selectedCategory) {
            onAction(
                { type: 'category', category: selectedCategory },
                { scope, duration: pendingDuration, close: true }
            )
        } else if (pendingDuration) {
            onAction({ type: 'duration', ...pendingDuration }, { close: true })
        } else {
            onLater()
        }
    }

    useEscapeKey(() => later())

    const handlersRef = useRef({})
    handlersRef.current = {
        rate,
        toggleCategory: () => setShowCategoryList(value => !value),
        toggleDuration: () => setShowDuration(value => !value),
    }

    useEffect(() => {
        if (typeof document === 'undefined') return undefined
        const onKeyDown = event => {
            if (
                event.defaultPrevented ||
                event.metaKey ||
                event.ctrlKey ||
                event.altKey ||
                isTypingTarget(event.target)
            )
                return
            const key = String(event.key || '').toLowerCase()
            const index = ['1', '2', '3'].indexOf(key)
            if (index >= 0 && !notAttended) {
                event.preventDefault()
                handlersRef.current.rate(MEETING_USEFULNESS_LEVELS[index])
            } else if (key === 'k') {
                event.preventDefault()
                handlersRef.current.toggleCategory()
            } else if (key === 'd') {
                event.preventDefault()
                handlersRef.current.toggleDuration()
            }
        }
        document.addEventListener('keydown', onKeyDown, true)
        return () => document.removeEventListener('keydown', onKeyDown, true)
    }, [notAttended])

    const dateLabel = `${localizedMoment(plannedStart).format('dd')} ${formatMeetingTime(plannedStart, timeFormat)}–${formatMeetingTime(
        plannedEnd,
        timeFormat
    )}`
    // E5: rating before the planned end is allowed, with a hint (a reminder after the end is stage 2).
    const endsLater = plannedEnd > nowMs

    const renderCategoryChip = (category, { compact = false, highlighted = false } = {}) => {
        const selected = selectedCategory === category
        return (
            <TouchableOpacity
                key={category}
                testID={`meeting-category-${category}`}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => pickCategory(category)}
                style={[
                    localStyles.categoryOption,
                    compact && localStyles.categoryChip,
                    selected && { borderColor: MEETING_CATEGORY_COLORS[category] },
                    highlighted && localStyles.categoryHighlighted,
                ]}
            >
                <View style={[localStyles.dot, { backgroundColor: MEETING_CATEGORY_COLORS[category] }]} />
                <Text style={localStyles.categoryName}>
                    {translate(MEETING_CATEGORY_LABEL_KEYS[category])}
                    {highlighted ? ' ✨' : ''}
                </Text>
                {!compact && (
                    <Text style={localStyles.categoryHint}>{translate(MEETING_CATEGORY_HINT_KEYS[category])}</Text>
                )}
                {!compact && resolved?.category === category && !resolved.confirmed && (
                    <Text style={localStyles.categoryHint}>{` ← ${translate('Meeting suggestion')}`}</Text>
                )}
            </TouchableOpacity>
        )
    }

    const shiftDuration = (startDeltaMin, endDeltaMin) => {
        const nextStart = durationStart + startDeltaMin * MIN
        const nextEnd = durationEnd + endDeltaMin * MIN
        if (nextEnd - nextStart < 5 * MIN) return
        setDurationStart(nextStart)
        setDurationEnd(nextEnd)
    }

    return (
        <View style={localStyles.card} dataSet={{ adPopup: 'true' }} testID="meeting-review-sheet">
            <View style={localStyles.headerRow}>
                <Text style={localStyles.title} numberOfLines={2}>
                    {`✓ ${task.name || ''}`}
                </Text>
                <TouchableOpacity
                    testID="meeting-review-close"
                    accessibilityLabel={translate('Meeting review later')}
                    onPress={later}
                    style={localStyles.closeButton}
                >
                    <Text style={localStyles.closeText}>×</Text>
                </TouchableOpacity>
            </View>
            <Text style={localStyles.subtitle}>
                {`${dateLabel} · ${formatMeetingDuration(plannedEnd - plannedStart)}`}
            </Text>
            {endsLater && !isEdit && (
                <Text style={localStyles.hint} testID="meeting-review-ends-later">
                    {translate('Meeting review ends later hint', { time: formatMeetingTime(plannedEnd, timeFormat) })}
                </Text>
            )}

            <View style={localStyles.section}>
                <View style={localStyles.categoryHeader}>
                    <Text style={localStyles.label}>{translate('Meeting category')}</Text>
                    {selectedCategory && !showCategoryList ? (
                        <TouchableOpacity
                            testID="meeting-category-selected"
                            onPress={() => setShowCategoryList(true)}
                            style={[
                                localStyles.categoryChip,
                                { borderColor: MEETING_CATEGORY_COLORS[selectedCategory] },
                            ]}
                        >
                            <View
                                style={[
                                    localStyles.dot,
                                    { backgroundColor: MEETING_CATEGORY_COLORS[selectedCategory] },
                                ]}
                            />
                            <Text style={localStyles.categoryName}>{`${translate(
                                MEETING_CATEGORY_LABEL_KEYS[selectedCategory]
                            )} ▾`}</Text>
                        </TouchableOpacity>
                    ) : null}
                    {!userPickedCategory && (
                        <Text style={localStyles.suggestionLabel} testID="meeting-suggestion-label">
                            {getSuggestionLabel(resolved)}
                        </Text>
                    )}
                    {resolved?.signals?.length > 0 && !resolved.confirmed && (
                        <TouchableOpacity testID="meeting-why" onPress={() => setShowWhy(value => !value)}>
                            <Text style={localStyles.link}>{translate('Meeting why')}</Text>
                        </TouchableOpacity>
                    )}
                </View>
                {showWhy && (
                    <Text style={localStyles.hint} testID="meeting-why-text">
                        {resolved.signals.map(item => translate(item.key, item.params)).join(' · ')}
                    </Text>
                )}
                {showCategoryList && (
                    <View testID="meeting-category-list">
                        {candidates.length > 0 && !selectedCategory ? (
                            <View style={localStyles.chipRow}>
                                {candidates.map(category =>
                                    renderCategoryChip(category, { compact: true, highlighted: true })
                                )}
                            </View>
                        ) : null}
                        {MEETING_CATEGORIES.filter(
                            category => !(candidates.includes(category) && !selectedCategory)
                        ).map(category => renderCategoryChip(category))}
                    </View>
                )}
                {userPickedCategory && seriesId && (
                    <View style={localStyles.scopeRow} testID="meeting-series-scope">
                        <Text style={localStyles.hint}>{translate('Meeting applies to')}</Text>
                        {['series', 'instance'].map(value => (
                            <TouchableOpacity
                                key={value}
                                testID={`meeting-scope-${value}`}
                                accessibilityRole="radio"
                                accessibilityState={{ checked: scope === value }}
                                onPress={() => setScope(value)}
                                style={[localStyles.scopeOption, scope === value && localStyles.scopeOptionSelected]}
                            >
                                <Text style={localStyles.scopeText}>
                                    {`${scope === value ? '◉' : '○'} ${translate(
                                        value === 'series' ? 'Meeting scope series' : 'Meeting scope instance'
                                    )}`}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                )}
            </View>

            {notAttended ? (
                <View style={localStyles.section}>
                    <Text style={localStyles.hint}>{translate('Meeting not attended info')}</Text>
                    <TouchableOpacity
                        testID="meeting-attended-again"
                        onPress={() => onAction({ type: 'attended' }, {})}
                    >
                        <Text style={localStyles.link}>{translate('Meeting attended after all')}</Text>
                    </TouchableOpacity>
                </View>
            ) : (
                <View style={localStyles.section}>
                    <Text style={localStyles.question}>{translate('Meeting usefulness question')}</Text>
                    <View style={localStyles.usefulnessRow}>
                        {MEETING_USEFULNESS_LEVELS.map((level, index) => {
                            const isCurrent = review?.usefulness === level && isRated
                            return (
                                <TouchableOpacity
                                    key={level}
                                    testID={`meeting-usefulness-${level}`}
                                    accessibilityRole="button"
                                    accessibilityLabel={translate(MEETING_USEFULNESS_LABEL_KEYS[level])}
                                    disabled={saving}
                                    onPress={() => rate(level)}
                                    style={[localStyles.usefulnessButton, isCurrent && localStyles.usefulnessCurrent]}
                                >
                                    <Text style={localStyles.emoji}>{MEETING_USEFULNESS_EMOJI[level]}</Text>
                                    <Text style={localStyles.usefulnessText} numberOfLines={1}>
                                        {translate(MEETING_USEFULNESS_LABEL_KEYS[level])}
                                    </Text>
                                    <Text style={localStyles.shortcut}>{index + 1}</Text>
                                </TouchableOpacity>
                            )
                        })}
                    </View>
                </View>
            )}

            {showDuration && (
                <View style={localStyles.section} testID="meeting-duration-panel">
                    <Text style={localStyles.hint}>
                        {translate('Meeting duration planned', {
                            duration: formatMeetingDuration(plannedEnd - plannedStart),
                            from: formatMeetingTime(plannedStart, timeFormat),
                            to: formatMeetingTime(plannedEnd, timeFormat),
                        })}
                    </Text>
                    <Text style={localStyles.label} testID="meeting-duration-current">
                        {`${formatMeetingTime(durationStart, timeFormat)} – ${formatMeetingTime(
                            durationEnd,
                            timeFormat
                        )} · ${formatMeetingDuration(durationEnd - durationStart)}`}
                    </Text>
                    <View style={localStyles.chipRow}>
                        {[
                            ['start-15', translate('Meeting start'), -15, 0, '−15'],
                            ['start+15', translate('Meeting start'), 15, 0, '+15'],
                            ['end-30', translate('Meeting end'), 0, -30, '−30'],
                            ['end-15', translate('Meeting end'), 0, -15, '−15'],
                            ['end+15', translate('Meeting end'), 0, 15, '+15'],
                        ].map(([id, label, startDelta, endDelta, text]) => (
                            <TouchableOpacity
                                key={id}
                                testID={`meeting-duration-${id}`}
                                onPress={() => shiftDuration(startDelta, endDelta)}
                                style={localStyles.smallButton}
                            >
                                <Text style={localStyles.smallButtonText}>{`${label} ${text}`}</Text>
                            </TouchableOpacity>
                        ))}
                        <TouchableOpacity
                            testID="meeting-duration-reset"
                            onPress={() => {
                                setDurationStart(plannedStart)
                                setDurationEnd(plannedEnd)
                            }}
                            style={localStyles.smallButton}
                        >
                            <Text style={localStyles.smallButtonText}>{translate('Meeting as planned')}</Text>
                        </TouchableOpacity>
                    </View>
                    {!notAttended && (
                        <TouchableOpacity
                            testID="meeting-not-attended"
                            onPress={() => onAction({ type: 'not_attended' }, { close: true })}
                        >
                            <Text style={localStyles.link}>{translate('Meeting not attended')}</Text>
                        </TouchableOpacity>
                    )}
                </View>
            )}

            <View style={localStyles.footer}>
                <TouchableOpacity testID="meeting-duration-toggle" onPress={() => setShowDuration(value => !value)}>
                    <Text style={localStyles.link}>
                        {durationChanged || Number.isFinite(review?.actualStartMs)
                            ? translate('Meeting duration adjusted', {
                                  duration: formatMeetingDuration(durationEnd - durationStart),
                              })
                            : translate('Meeting duration as planned change')}
                    </Text>
                </TouchableOpacity>
                <View style={localStyles.footerRight}>
                    {queueRemaining > 0 && onStartQueue && (
                        <TouchableOpacity testID="meeting-review-queue" onPress={onStartQueue}>
                            <Text style={localStyles.link}>
                                {translate('Meeting rate more', { count: queueRemaining })}
                            </Text>
                        </TouchableOpacity>
                    )}
                    {isEdit && isRated && (
                        <TouchableOpacity
                            testID="meeting-review-clear"
                            onPress={() => onAction({ type: 'clear' }, { close: true })}
                        >
                            <Text style={localStyles.link}>{translate('Meeting remove rating')}</Text>
                        </TouchableOpacity>
                    )}
                    {onOpenStatistics && (
                        <TouchableOpacity testID="meeting-review-statistics" onPress={onOpenStatistics}>
                            <Text style={localStyles.link}>{translate('Meeting time statistics')}</Text>
                        </TouchableOpacity>
                    )}
                    <TouchableOpacity testID="meeting-review-later" onPress={later}>
                        <Text
                            style={localStyles.later}
                        >{`${translate(isEdit ? 'Close' : 'Meeting review later')} ⎋`}</Text>
                    </TouchableOpacity>
                </View>
            </View>
        </View>
    )
}

const TEXT = '#ffffff'

const localStyles = StyleSheet.create({
    card: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        padding: 16,
        boxShadow: themed.PopupShadow,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
    },
    title: {
        ...styles.subtitle1,
        color: TEXT,
        flex: 1,
    },
    closeButton: {
        paddingHorizontal: 8,
    },
    closeText: {
        ...styles.subtitle1,
        color: colors.Grey400,
    },
    subtitle: {
        ...styles.caption2,
        color: colors.Grey400,
    },
    section: {
        marginTop: 12,
    },
    categoryHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        rowGap: 4,
        columnGap: 8,
    },
    label: {
        ...styles.subtitle2,
        color: TEXT,
    },
    question: {
        ...styles.subtitle2,
        color: TEXT,
        marginBottom: 8,
    },
    suggestionLabel: {
        ...styles.caption2,
        color: colors.Grey400,
    },
    link: {
        ...styles.caption1,
        color: colors.UtilityBlue200,
    },
    hint: {
        ...styles.caption2,
        color: colors.Grey400,
        marginTop: 4,
    },
    chipRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: 8,
        marginTop: 8,
    },
    categoryOption: {
        flexDirection: 'row',
        alignItems: 'center',
        flexWrap: 'wrap',
        paddingVertical: 6,
        paddingHorizontal: 8,
        marginTop: 4,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: 'transparent',
        backgroundColor: colors.Secondary300,
    },
    categoryChip: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 2,
        paddingHorizontal: 8,
        marginTop: 0,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.Secondary200,
        backgroundColor: colors.Secondary200,
    },
    categoryHighlighted: {
        borderStyle: 'dashed',
        borderColor: colors.Grey400,
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 6,
    },
    categoryName: {
        ...styles.caption1,
        color: TEXT,
        marginRight: 6,
    },
    categoryHint: {
        ...styles.caption2,
        color: colors.Grey400,
    },
    scopeRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 8,
        marginTop: 8,
    },
    scopeOption: {
        paddingVertical: 2,
        paddingHorizontal: 6,
        borderRadius: 4,
    },
    scopeOptionSelected: {
        backgroundColor: colors.Secondary300,
    },
    scopeText: {
        ...styles.caption1,
        color: TEXT,
    },
    usefulnessRow: {
        flexDirection: 'row',
        gap: 8,
    },
    usefulnessButton: {
        flex: 1,
        alignItems: 'center',
        paddingVertical: 8,
        paddingHorizontal: 4,
        borderRadius: 4,
        backgroundColor: colors.Secondary200,
        borderWidth: 1,
        borderColor: 'transparent',
    },
    usefulnessCurrent: {
        borderColor: colors.UtilityBlue200,
    },
    emoji: {
        fontSize: 20,
        lineHeight: 26,
    },
    usefulnessText: {
        ...styles.caption1,
        color: TEXT,
    },
    shortcut: {
        ...styles.caption2,
        color: colors.Grey400,
    },
    smallButton: {
        paddingVertical: 2,
        paddingHorizontal: 8,
        borderRadius: 4,
        backgroundColor: colors.Secondary200,
    },
    smallButtonText: {
        ...styles.caption2,
        color: TEXT,
    },
    footer: {
        marginTop: 12,
        flexDirection: 'row',
        flexWrap: 'wrap',
        justifyContent: 'space-between',
        alignItems: 'center',
        rowGap: 8,
    },
    footerRight: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 12,
    },
    later: {
        ...styles.caption1,
        color: TEXT,
    },
})
