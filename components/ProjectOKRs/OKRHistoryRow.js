import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import {
    OKR_PACE_AT_RISK,
    OKR_PACE_ENDED,
    OKR_PACE_OFF_TRACK,
    OKR_STATUS_CLOSED,
    calculateOkrPace,
    formatOkrPeriodRange,
    formatOkrValue,
    getOkrTimeLeftParts,
    isOkrPrivate,
} from '../TaskListView/OKRs/okrHelper'

const SEGMENTS = [0, 1, 2, 3, 4]

const OKR_PACE_COLORS = {
    default: colors.UtilityGreen200,
    [OKR_PACE_AT_RISK]: colors.UtilityYellow200,
    [OKR_PACE_OFF_TRACK]: colors.Red200,
    [OKR_PACE_ENDED]: colors.Red200,
}

function getPaceColor(status) {
    return OKR_PACE_COLORS[status] || OKR_PACE_COLORS.default
}

// Read-only OKR row used by the OKR history tab. Mirrors the visual language of
// OKRItem (status accent, segmented progress, pace label) but never edits the OKR;
// closed OKRs render their stored final value and an optional recap link.
export default function OKRHistoryRow({ okr, projectName, recapChatId, onOpenRecap }) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const privateOkr = isOkrPrivate(okr)
    const isClosed = okr.status === OKR_STATUS_CLOSED
    const pace = calculateOkrPace(okr)
    const progress = pace.actualPercent
    const paceColor = getPaceColor(pace.status)
    const timeLeft = getOkrTimeLeftParts(okr.periodEnd)

    const metaText = `${formatOkrValue(okr.currentValue, okr.unit)} / ${formatOkrValue(
        okr.targetValue,
        okr.unit
    )} · ${translate(`OKR cadence ${okr.cadence}`)} · ${formatOkrPeriodRange(okr.periodStart, okr.periodEnd)}`

    return (
        <View style={[localStyles.container, mobile && localStyles.containerMobile]}>
            <View style={[localStyles.statusAccent, { backgroundColor: paceColor }]} />
            <View style={[localStyles.titleArea, mobile && localStyles.titleAreaMobile]}>
                <View style={localStyles.titleRow}>
                    {!!projectName && (
                        <Text style={[styles.caption1, localStyles.projectTag]} numberOfLines={1}>
                            {projectName}
                        </Text>
                    )}
                    <Text
                        style={[styles.subtitle1, localStyles.title, localStyles.titleInRow]}
                        numberOfLines={mobile ? 2 : 1}
                    >
                        {okr.label}
                    </Text>
                    {privateOkr && <Icon name="lock" size={12} color={colors.Text03} style={localStyles.lockIcon} />}
                </View>
                <Text style={[styles.caption1, localStyles.meta]} numberOfLines={mobile ? 2 : 1}>
                    {metaText}
                </Text>
                {isClosed && !!recapChatId && (
                    <TouchableOpacity
                        style={localStyles.recapLink}
                        onPress={() => onOpenRecap(okr.projectId, recapChatId)}
                        accessibilityLabel={translate('View recap')}
                    >
                        <Icon name="comments-thread" size={12} color={colors.Primary100} />
                        <Text style={[styles.caption1, localStyles.recapText]}>{translate('View recap')}</Text>
                    </TouchableOpacity>
                )}
            </View>
            <View style={[localStyles.progressArea, mobile && localStyles.progressAreaMobile]}>
                <View style={[localStyles.chart, mobile && localStyles.chartMobile]}>
                    {!isClosed && <View style={[localStyles.expectedMarker, { left: `${pace.expectedPercent}%` }]} />}
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
                <View style={localStyles.progressTextArea}>
                    <View style={localStyles.progressNumbers}>
                        <Text style={[styles.subtitle2, localStyles.percent]}>{`${progress}%`}</Text>
                        {!isClosed && (
                            <Text style={[styles.caption1, localStyles.timeLeft]}>
                                {translate(timeLeft.textKey, timeLeft.interpolations)}
                            </Text>
                        )}
                    </View>
                    <Text style={[styles.caption1, localStyles.paceLabel, { color: paceColor }]} numberOfLines={1}>
                        {translate(pace.textKey)}
                    </Text>
                </View>
            </View>
        </View>
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
        paddingLeft: 16,
    },
    containerMobile: {
        minHeight: 92,
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'center',
        paddingVertical: 12,
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
    titleRow: {
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'flex-start',
        maxWidth: '100%',
    },
    projectTag: {
        color: colors.Text03,
        marginRight: 8,
    },
    title: {
        color: colors.Text01,
    },
    titleInRow: {
        flexShrink: 1,
        marginRight: 12,
    },
    lockIcon: {
        marginRight: 12,
    },
    meta: {
        color: colors.Text03,
        marginTop: 2,
    },
    recapLink: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 6,
    },
    recapText: {
        color: colors.Primary100,
        marginLeft: 4,
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
    timeLeft: {
        color: colors.Text03,
        width: 72,
        textAlign: 'right',
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
