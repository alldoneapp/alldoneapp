import React, { useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import { popoverToSafePosition } from '../../../utils/HelperFunctions'
import { updateOKRCurrentValue } from '../../../utils/backends/OKRs/okrsFirestore'
import OKRModal from './OKRModal'
import {
    OKR_PACE_AT_RISK,
    OKR_PACE_ENDED,
    OKR_PACE_OFF_TRACK,
    calculateOkrPace,
    formatOkrValue,
    getOkrTimeLeftParts,
    isRevenueOkr,
    resolveOkrCurrentValue,
} from './okrHelper'
import useOkrRevenueValue from './useOkrRevenueValue'

const SEGMENTS = [0, 1, 2, 3, 4]
const CELEBRATION_DOTS = [
    { x: -18, y: -24, color: colors.UtilityGreen200 },
    { x: 2, y: -30, color: colors.UtilityYellow200 },
    { x: 20, y: -20, color: colors.UtilityBlue200 },
]

const OKR_PACE_COLORS = {
    default: colors.UtilityGreen200,
    [OKR_PACE_AT_RISK]: colors.UtilityYellow200,
    [OKR_PACE_OFF_TRACK]: colors.Red200,
    [OKR_PACE_ENDED]: colors.Red200,
}

function getPaceColor(status) {
    return OKR_PACE_COLORS[status] || OKR_PACE_COLORS.default
}

export default function OKRItem({ projectId, okr, canUpdate }) {
    const [isOpen, setIsOpen] = useState(false)
    const [incrementing, setIncrementing] = useState(false)
    const celebration = useRef(new Animated.Value(0)).current
    const mobile = useSelector(state => state.smallScreenNavigation)
    const revenueOkr = isRevenueOkr(okr)
    const revenueValue = useOkrRevenueValue({
        projectId,
        ownerId: revenueOkr ? okr.ownerId : null,
        periodStart: okr.periodStart,
        periodEnd: okr.periodEnd,
    })
    const currentValue = resolveOkrCurrentValue(okr, revenueValue.currentValue)
    const resolvedOkr = { ...okr, currentValue, resolvedCurrentValue: currentValue }
    const timeLeft = getOkrTimeLeftParts(resolvedOkr.periodEnd)
    const pace = calculateOkrPace(resolvedOkr)
    const progress = pace.actualPercent
    const paceColor = getPaceColor(pace.status)
    const metaText = `${formatOkrValue(currentValue, okr.unit)} / ${formatOkrValue(
        okr.targetValue,
        okr.unit
    )} · ${translate(`OKR cadence ${okr.cadence}`)}${
        revenueOkr && revenueValue.missingHourlyRate ? ` · ${translate('OKR hourly rate missing')}` : ''
    }`

    const runCelebration = () => {
        celebration.stopAnimation()
        celebration.setValue(0)
        Animated.timing(celebration, {
            toValue: 1,
            duration: 650,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
        }).start(() => {
            celebration.setValue(0)
        })
    }

    const incrementOKR = async event => {
        event?.stopPropagation?.()
        if (!canUpdate || incrementing || revenueOkr) return
        setIncrementing(true)
        runCelebration()
        try {
            await updateOKRCurrentValue(projectId, okr.id, okr.currentValue + 1)
        } finally {
            setIncrementing(false)
        }
    }

    const trigger = (
        <TouchableOpacity
            style={[localStyles.container, mobile && localStyles.containerMobile, !canUpdate && localStyles.disabled]}
            onPress={() => canUpdate && setIsOpen(true)}
            disabled={!canUpdate}
        >
            <View style={[localStyles.statusAccent, { backgroundColor: paceColor }]} />
            <View style={[localStyles.titleArea, mobile && localStyles.titleAreaMobile]}>
                <Text style={[styles.subtitle1, localStyles.title]} numberOfLines={mobile ? 2 : 1}>
                    {okr.label}
                </Text>
                <Text style={[styles.caption1, localStyles.meta]} numberOfLines={mobile ? 2 : 1}>
                    {metaText}
                </Text>
            </View>
            <View style={[localStyles.progressArea, mobile && localStyles.progressAreaMobile]}>
                {!revenueOkr && (
                    <View style={localStyles.incrementContainer}>
                        <TouchableOpacity
                            style={[localStyles.incrementButton, incrementing && localStyles.incrementButtonDisabled]}
                            onPress={incrementOKR}
                            disabled={!canUpdate || incrementing}
                            accessibilityLabel={translate('Increase OKR by 1')}
                        >
                            <Icon name="plus" size={16} color="#ffffff" />
                        </TouchableOpacity>
                        <CelebrationBurst animation={celebration} />
                    </View>
                )}
                <View
                    style={[localStyles.chart, mobile && localStyles.chartMobile]}
                    accessibilityLabel={translate('OKR expected progress marker', {
                        expected: pace.expectedPercent,
                    })}
                >
                    <View style={[localStyles.expectedMarker, { left: `${pace.expectedPercent}%` }]} />
                    {SEGMENTS.map(index => {
                        const segmentProgress = Math.max(0, Math.min(20, progress - index * 20)) / 20
                        return (
                            <View key={index} style={[localStyles.segment, mobile && localStyles.segmentMobile]}>
                                <View
                                    style={[
                                        localStyles.segmentFill,
                                        mobile && localStyles.segmentFillMobile,
                                        { backgroundColor: paceColor },
                                        { height: `${segmentProgress * 100}%` },
                                    ]}
                                />
                            </View>
                        )
                    })}
                </View>
                <View style={[localStyles.progressTextArea, mobile && localStyles.progressTextAreaMobile]}>
                    <View style={localStyles.progressNumbers}>
                        <Text style={[styles.subtitle2, localStyles.percent, mobile && localStyles.percentMobile]}>
                            {`${progress}%`}
                        </Text>
                        <Text style={[styles.caption1, localStyles.timeLeft, mobile && localStyles.timeLeftMobile]}>
                            {translate(timeLeft.textKey, timeLeft.interpolations)}
                        </Text>
                    </View>
                    <Text style={[styles.caption1, localStyles.paceLabel, { color: paceColor }]} numberOfLines={1}>
                        {translate(pace.textKey)}
                    </Text>
                </View>
            </View>
        </TouchableOpacity>
    )

    return (
        <Popover
            isOpen={isOpen}
            position={['bottom', 'top', 'right', 'left']}
            align="start"
            padding={4}
            onClickOutside={() => setIsOpen(false)}
            contentLocation={args => popoverToSafePosition(args, false)}
            content={<OKRModal projectId={projectId} okr={okr} closePopover={() => setIsOpen(false)} />}
        >
            {trigger}
        </Popover>
    )
}

function CelebrationBurst({ animation }) {
    const opacity = animation.interpolate({
        inputRange: [0, 0.15, 0.8, 1],
        outputRange: [0, 1, 1, 0],
    })
    const labelTranslateY = animation.interpolate({
        inputRange: [0, 1],
        outputRange: [0, -28],
    })
    const labelScale = animation.interpolate({
        inputRange: [0, 0.2, 1],
        outputRange: [0.7, 1.15, 1],
    })

    return (
        <View pointerEvents="none" style={localStyles.celebrationLayer}>
            <Animated.Text
                style={[
                    styles.subtitle2,
                    localStyles.celebrationText,
                    {
                        opacity,
                        transform: [{ translateY: labelTranslateY }, { scale: labelScale }],
                    },
                ]}
            >
                +1
            </Animated.Text>
            {CELEBRATION_DOTS.map((dot, index) => {
                const translateX = animation.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, dot.x],
                })
                const translateY = animation.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, dot.y],
                })
                const scale = animation.interpolate({
                    inputRange: [0, 0.2, 1],
                    outputRange: [0.4, 1, 0.5],
                })

                return (
                    <Animated.View
                        key={index}
                        style={[
                            localStyles.celebrationDot,
                            {
                                backgroundColor: dot.color,
                                opacity,
                                transform: [{ translateX }, { translateY }, { scale }],
                            },
                        ]}
                    />
                )
            })}
        </View>
    )
}

export function OKREmptyItem({ projectId, canUpdate, compact }) {
    const [isOpen, setIsOpen] = useState(false)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const shrinkTag = compact && smallScreenNavigation
    const trigger = (
        <TouchableOpacity
            style={[
                compact ? localStyles.compactAddButton : localStyles.emptyContainer,
                shrinkTag && localStyles.compactAddButtonMobile,
                !canUpdate && localStyles.disabled,
            ]}
            onPress={() => canUpdate && setIsOpen(true)}
            disabled={!canUpdate}
        >
            <View style={localStyles.compactAddIcon}>
                <Icon
                    name={compact ? 'plus' : 'add-task'}
                    size={compact ? 14 : 16}
                    color={compact ? colors.Text03 : colors.Primary100}
                />
            </View>
            {!shrinkTag && (
                <Text
                    style={[
                        compact ? styles.caption1 : styles.subtitle1,
                        compact ? localStyles.compactAddText : localStyles.emptyText,
                    ]}
                >
                    {translate('Add OKR')}
                </Text>
            )}
        </TouchableOpacity>
    )

    return (
        <Popover
            isOpen={isOpen}
            position={['bottom', 'top', 'right', 'left']}
            align="start"
            padding={4}
            onClickOutside={() => setIsOpen(false)}
            contentLocation={args => popoverToSafePosition(args, false)}
            content={<OKRModal projectId={projectId} closePopover={() => setIsOpen(false)} />}
        >
            {trigger}
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    container: {
        minHeight: 56,
        borderBottomWidth: 1,
        borderBottomColor: colors.Grey200,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 8,
        paddingLeft: 8,
    },
    containerMobile: {
        minHeight: 92,
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'center',
        paddingVertical: 12,
    },
    emptyContainer: {
        height: 40,
        borderBottomWidth: 1,
        borderBottomColor: colors.Grey200,
        flexDirection: 'row',
        alignItems: 'center',
    },
    compactAddButton: {
        height: 22,
        justifyContent: 'center',
        paddingHorizontal: 2,
        flexDirection: 'row',
        alignItems: 'center',
    },
    compactAddButtonMobile: {
        width: 22,
        height: 22,
    },
    compactAddIcon: {
        flexDirection: 'row',
        alignSelf: 'center',
    },
    emptyText: {
        color: colors.Primary100,
        marginLeft: 6,
    },
    compactAddText: {
        color: colors.Text03,
        marginLeft: 4,
    },
    disabled: {
        opacity: 0.6,
    },
    statusAccent: {
        position: 'absolute',
        left: 0,
        top: 8,
        bottom: 8,
        width: 3,
        borderRadius: 2,
    },
    titleArea: {
        flex: 1,
        paddingRight: 12,
    },
    titleAreaMobile: {
        paddingRight: 0,
    },
    title: {
        color: colors.Text01,
    },
    meta: {
        color: colors.Text03,
        marginTop: 2,
    },
    progressArea: {
        minWidth: 212,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
    },
    progressAreaMobile: {
        width: '100%',
        minWidth: 0,
        justifyContent: 'space-between',
        marginTop: 10,
    },
    incrementContainer: {
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
    },
    incrementButton: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: colors.Primary100,
        alignItems: 'center',
        justifyContent: 'center',
    },
    incrementButtonDisabled: {
        opacity: 0.72,
    },
    celebrationLayer: {
        position: 'absolute',
        width: 52,
        height: 52,
        left: -10,
        top: -18,
        alignItems: 'center',
        justifyContent: 'center',
    },
    celebrationText: {
        position: 'absolute',
        color: colors.UtilityGreen200,
        textShadowColor: '#ffffff',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 3,
    },
    celebrationDot: {
        position: 'absolute',
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    chart: {
        width: 44,
        height: 24,
        flexDirection: 'row',
        alignItems: 'flex-end',
        marginRight: 8,
        position: 'relative',
    },
    chartMobile: {
        width: 76,
        height: 30,
        marginRight: 12,
    },
    segment: {
        width: 6,
        height: 24,
        borderRadius: 2,
        backgroundColor: colors.Grey300,
        marginRight: 2,
        justifyContent: 'flex-end',
        overflow: 'hidden',
    },
    segmentMobile: {
        width: 10,
        height: 30,
        marginRight: 3,
    },
    segmentFill: {
        width: 6,
    },
    segmentFillMobile: {
        width: 10,
    },
    progressTextArea: {
        alignItems: 'flex-end',
    },
    progressTextAreaMobile: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    progressNumbers: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    percent: {
        color: colors.Text01,
        width: 40,
        textAlign: 'right',
        marginRight: 8,
    },
    percentMobile: {
        width: 48,
    },
    timeLeft: {
        color: colors.Text03,
        width: 72,
        textAlign: 'right',
    },
    timeLeftMobile: {
        width: 96,
    },
    paceLabel: {
        marginTop: 1,
        maxWidth: 120,
        textAlign: 'right',
    },
    expectedMarker: {
        position: 'absolute',
        top: -2,
        bottom: -2,
        width: 2,
        borderRadius: 1,
        backgroundColor: colors.Text02,
        opacity: 0.45,
        zIndex: 2,
    },
})
