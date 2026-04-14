import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'
import moment from 'moment'

import styles, { colors } from '../../../styles/global'
import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import { getHeartbeatIntervalMs } from './heartbeatIntervalHelper'
import { getHeartbeatStatusForUser } from './heartbeatStatusHelper'

export default function HeartbeatStatusProperty({ projectId, assistant }) {
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const defaultProjectId = useSelector(state => state.loggedUser.defaultProjectId)

    const isDefaultAssistantInDefaultProject = assistant.isDefault && projectId === defaultProjectId
    const chancePercent = assistant.heartbeatChancePercent ?? (isDefaultAssistantInDefaultProject ? 10 : 0)
    const intervalMs = getHeartbeatIntervalMs(assistant.heartbeatIntervalMs)
    const { lastCheckedAt, lastExecutedAt, hasRecentCheck, lastResult } = getHeartbeatStatusForUser(
        assistant,
        loggedUserId,
        intervalMs
    )

    const status = getHeartbeatBadgeStatus(chancePercent, hasRecentCheck, lastCheckedAt)
    const lastResultLabel =
        lastResult === 'executed'
            ? translate('Executed')
            : lastResult === 'not_executed'
            ? translate('Not executed')
            : translate('Never')

    return (
        <View style={localStyles.container}>
            <View style={localStyles.headerRow}>
                <View style={localStyles.titleRow}>
                    <Icon name="check-circle" size={24} color={colors.Text03} style={localStyles.icon} />
                    <Text style={[styles.subtitle2, { color: colors.Text03 }]}>{translate('Heartbeat status')}</Text>
                </View>
                <View
                    style={[
                        localStyles.badge,
                        {
                            backgroundColor: status.backgroundColor,
                            borderColor: status.borderColor,
                        },
                    ]}
                >
                    <View style={[localStyles.badgeDot, { backgroundColor: status.dotColor }]} />
                    <Text style={[styles.caption2, { color: status.textColor }]}>{status.label}</Text>
                </View>
            </View>
            <View style={localStyles.details}>
                <StatusDetail label={translate('Last checked')} value={formatTimestamp(lastCheckedAt)} />
                <StatusDetail label={translate('Last result')} value={lastResultLabel} />
                <StatusDetail label={translate('Last executed')} value={formatTimestamp(lastExecutedAt)} />
            </View>
        </View>
    )
}

function StatusDetail({ label, value }) {
    return (
        <View style={localStyles.detailRow}>
            <Text style={[styles.caption2, { color: colors.Text03 }]}>{label}</Text>
            <Text style={[styles.body2, localStyles.detailValue]}>{value}</Text>
        </View>
    )
}

function formatTimestamp(timestamp) {
    if (!timestamp) {
        return translate('Never')
    }

    return `${moment(timestamp).fromNow()} • ${moment(timestamp).format('MMM D, h:mm A')}`
}

function getHeartbeatBadgeStatus(chancePercent, hasRecentCheck, lastCheckedAt) {
    if (chancePercent <= 0) {
        return {
            label: translate('Inactive'),
            backgroundColor: colors.Grey200,
            borderColor: colors.Grey400,
            dotColor: colors.Text03,
            textColor: colors.Text02,
        }
    }

    if (hasRecentCheck) {
        return {
            label: translate('Working'),
            backgroundColor: colors.UtilityGreen100,
            borderColor: colors.UtilityGreen125,
            dotColor: colors.UtilityGreen300,
            textColor: colors.Green400,
        }
    }

    if (lastCheckedAt) {
        return {
            label: translate('No recent check'),
            backgroundColor: colors.UtilityYellow100,
            borderColor: colors.UtilityYellow125,
            dotColor: colors.UtilityYellow300,
            textColor: colors.Yellow400,
        }
    }

    return {
        label: translate('No checks yet'),
        backgroundColor: colors.Grey200,
        borderColor: colors.Grey400,
        dotColor: colors.Text03,
        textColor: colors.Text02,
    }
}

const localStyles = StyleSheet.create({
    container: {
        paddingLeft: 8,
        paddingVertical: 8,
    },
    headerRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 8,
    },
    titleRow: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 8,
    },
    icon: {
        marginRight: 8,
    },
    badge: {
        flexDirection: 'row',
        alignItems: 'center',
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 4,
    },
    badgeDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginRight: 6,
    },
    details: {
        paddingLeft: 32,
    },
    detailRow: {
        marginBottom: 8,
    },
    detailValue: {
        color: colors.Text01,
        marginTop: 2,
    },
})
