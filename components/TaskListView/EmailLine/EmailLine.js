import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'
import NavigationService from '../../../utils/NavigationService'
import SettingsHelper from '../../SettingsView/SettingsHelper'
import { DV_TAB_SETTINGS_INTEGRATIONS } from '../../../utils/TabNavigationConstants'
import { listEmailConnections } from '../../../utils/IntegrationProviders'
import { fetchEmailLineSummary } from '../../../utils/backends/EmailLine/emailLineBackend'
import {
    setUserEmailLineHiddenTodayForConnections,
    clearUserEmailLineHiddenTodayForConnections,
} from '../../../utils/backends/Users/usersFirestore'
import EmailLabelChip from './EmailLabelChip'
import {
    areEmailLineConnectionsHiddenToday,
    getEmailLineTodayKey,
    mergeLabelsAcrossConnections,
    splitChipsForDisplay,
} from './emailLineHelper'

// The unified Email line (All Projects only): ALL connected accounts merged into
// one line, labels grouped by display name across accounts. Summaries stay keyed
// per connection in redux; the merge happens at render time.
export default function EmailLine() {
    const loggedUser = useSelector(state => state.loggedUser)
    const summariesByKey = useSelector(state => state.emailLineSummaryByProject)
    const [showAllChips, setShowAllChips] = useState(false)

    const connections = listEmailConnections(loggedUser)
    const connectionIds = connections.map(connection => connection.connectionId)
    const connectionIdsKey = connectionIds.join(',')

    const hiddenToday = areEmailLineConnectionsHiddenToday(loggedUser, connectionIds)

    useEffect(() => {
        connectionIds.forEach(connectionId => {
            fetchEmailLineSummary(connectionId)
        })
    }, [connectionIdsKey])

    if (connections.length === 0) return null

    const hideForToday = () => {
        setUserEmailLineHiddenTodayForConnections(loggedUser.uid, connectionIds, getEmailLineTodayKey(loggedUser))
    }

    const showAgain = () => {
        clearUserEmailLineHiddenTodayForConnections(loggedUser.uid, connectionIds)
    }

    const reload = () => {
        connectionIds.forEach(connectionId => {
            fetchEmailLineSummary(connectionId, { force: true })
        })
    }

    const openSettings = () => {
        SettingsHelper.processURLSettingsTab(NavigationService, DV_TAB_SETTINGS_INTEGRATIONS)
    }

    // When done for today, collapse to just the header + a "Show again" pill.
    if (hiddenToday) {
        return (
            <View style={localStyles.container}>
                <View style={localStyles.header}>
                    <View style={localStyles.headerLeft}>
                        <Icon name="mail" size={14} color={colors.Text03} style={localStyles.headerIcon} />
                        <Text style={[styles.caption1, localStyles.headerText]}>{translate('Email')}</Text>
                    </View>
                    <View style={localStyles.headerRight}>
                        <TouchableOpacity
                            style={localStyles.doneButton}
                            onPress={showAgain}
                            disabled={!loggedUser.uid}
                            accessibilityLabel={translate('Show again')}
                        >
                            <Icon name="rotate-ccw" size={12} color={colors.Text03} />
                            <Text style={[styles.caption1, localStyles.doneButtonText]}>{translate('Show again')}</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        )
    }

    const summaries = connections.map(connection => summariesByKey[connection.connectionId])
    const loadedSummaries = summaries.filter(Boolean)
    const expiredConnections = connections.filter(
        (connection, index) => summaries[index]?.authExpired || connection.authInvalid
    )

    const groups = mergeLabelsAcrossConnections(connections, summariesByKey)
    // A sweeping group stays visible (with a spinner) even though its count was
    // optimistically zeroed.
    const visibleGroups = groups.filter(group => group.threadCount > 0 || group.sweeping)
    const inboxZero =
        loadedSummaries.length === connections.length && expiredConnections.length === 0 && visibleGroups.length === 0
    const { visible, overflowCount } = splitChipsForDisplay(visibleGroups, showAllChips)

    const labelOptionsByConnectionId = {}
    const labelingDisabledByConnectionId = {}
    connections.forEach(connection => {
        const summary = summariesByKey[connection.connectionId]
        labelOptionsByConnectionId[connection.connectionId] = (summary?.labels || [])
            .map(label => label.displayName)
            .filter(Boolean)
        labelingDisabledByConnectionId[connection.connectionId] =
            !!summary && connection.provider !== 'microsoft' && summary.labelingEnabled === false
    })

    return (
        <View style={localStyles.container}>
            <View style={localStyles.header}>
                <View style={localStyles.headerLeft}>
                    <Icon name="mail" size={14} color={colors.Text03} style={localStyles.headerIcon} />
                    <Text style={[styles.caption1, localStyles.headerText]}>{translate('Email')}</Text>
                    <TouchableOpacity
                        style={localStyles.iconButton}
                        onPress={reload}
                        accessibilityLabel={translate('Reload')}
                    >
                        <Icon name="refresh-cw" size={14} color={colors.Text03} />
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={localStyles.iconButton}
                        onPress={openSettings}
                        accessibilityLabel={translate('Integrations')}
                    >
                        <Icon name="settings" size={14} color={colors.Text03} />
                    </TouchableOpacity>
                </View>
                <View style={localStyles.headerRight}>
                    <TouchableOpacity
                        style={localStyles.doneButton}
                        onPress={hideForToday}
                        disabled={!loggedUser.uid}
                        accessibilityLabel={translate('Done for today')}
                    >
                        <Icon name="check" size={12} color={colors.Text03} />
                        <Text style={[styles.caption1, localStyles.doneButtonText]}>{translate('Done for today')}</Text>
                    </TouchableOpacity>
                </View>
            </View>

            {expiredConnections.map(connection => (
                <TouchableOpacity key={connection.connectionId} style={localStyles.stateRow} onPress={openSettings}>
                    <Icon name="alert-circle" size={14} color={colors.UtilityYellow300} />
                    <Text style={[styles.caption1, localStyles.reconnectText]} numberOfLines={1}>
                        {translate('Reconnect email')}
                        {connections.length > 1 && connection.email ? ` · ${connection.email}` : ''}
                    </Text>
                </TouchableOpacity>
            ))}

            {inboxZero ? (
                <View style={localStyles.stateRow}>
                    <Text style={[styles.caption1, localStyles.inboxZeroText]}>{translate('Inbox Zero')} 🎉</Text>
                </View>
            ) : (
                visible.length + overflowCount > 0 && (
                    <View style={localStyles.chipsRow}>
                        {visible.map(group => (
                            <EmailLabelChip
                                key={group.key}
                                group={group}
                                labelOptionsByConnectionId={labelOptionsByConnectionId}
                                labelingDisabledByConnectionId={labelingDisabledByConnectionId}
                            />
                        ))}
                        {overflowCount > 0 && (
                            <TouchableOpacity style={localStyles.overflowChip} onPress={() => setShowAllChips(true)}>
                                <Text style={[styles.caption1, localStyles.overflowText]}>{`+${overflowCount}`}</Text>
                            </TouchableOpacity>
                        )}
                    </View>
                )
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        paddingTop: 12,
    },
    header: {
        minHeight: 24,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerLeft: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    headerIcon: {
        marginRight: 6,
    },
    headerText: {
        color: colors.Text03,
        marginRight: 8,
    },
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    iconButton: {
        height: 22,
        paddingHorizontal: 2,
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 8,
    },
    doneButton: {
        height: 22,
        borderRadius: 11,
        backgroundColor: '#ffffff',
        borderWidth: 1,
        borderColor: colors.Grey400,
        paddingHorizontal: 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
    },
    doneButtonText: {
        color: colors.Text03,
        marginLeft: 4,
    },
    chipsRow: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
        marginTop: 8,
    },
    overflowChip: {
        height: 24,
        paddingHorizontal: 10,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.Grey300,
        backgroundColor: '#ffffff',
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
    },
    overflowText: {
        color: colors.Text03,
    },
    stateRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
        height: 24,
    },
    inboxZeroText: {
        color: colors.Text03,
    },
    reconnectText: {
        color: colors.UtilityYellow300,
        marginLeft: 6,
    },
})
