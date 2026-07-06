import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'
import NavigationService from '../../../utils/NavigationService'
import SettingsHelper from '../../SettingsView/SettingsHelper'
import { DV_TAB_SETTINGS_INTEGRATIONS } from '../../../utils/TabNavigationConstants'
import {
    CONNECTION_SERVICE_EMAIL,
    getConnectionsForProject,
    getProviderLabel,
    listEmailConnections,
} from '../../../utils/IntegrationProviders'
import { fetchEmailLineSummary } from '../../../utils/backends/EmailLine/emailLineBackend'
import {
    setUserEmailLineHiddenTodayForConnections,
    clearUserEmailLineHiddenTodayForConnections,
} from '../../../utils/backends/Users/usersFirestore'
import EmailLabelChip from './EmailLabelChip'
import { areEmailLineConnectionsHiddenToday, getEmailLineTodayKey, splitChipsForDisplay } from './emailLineHelper'

// One row for one connected account: optional account caption (multi-account view),
// state rows (auth expired / inbox zero handled by the parent), and the label chips.
function ConnectionChips({ connection, summary, showAccountCaption, labelingDisabled, showAllChips, onShowAll }) {
    const emailAddress = summary?.emailAddress || connection.email
    const unreadLabels = (summary?.labels || []).filter(label => label.unreadCount > 0)
    const { visible, overflowCount } = splitChipsForDisplay(unreadLabels, showAllChips)
    const authExpired = summary?.authExpired || connection.authInvalid
    const labelOptions = (summary?.labels || []).map(label => label.displayName).filter(Boolean)

    const openSettings = () => {
        SettingsHelper.processURLSettingsTab(NavigationService, DV_TAB_SETTINGS_INTEGRATIONS)
    }

    if (!authExpired && unreadLabels.length === 0) return null

    return (
        <View>
            {showAccountCaption && (
                <View style={localStyles.accountCaption}>
                    <Text style={[styles.caption2, localStyles.accountCaptionText]} numberOfLines={1}>
                        {connection.email}
                    </Text>
                    <Text style={[styles.caption2, localStyles.accountCaptionProvider]}>
                        {getProviderLabel(connection.provider)}
                    </Text>
                </View>
            )}

            {authExpired ? (
                <TouchableOpacity style={localStyles.stateRow} onPress={openSettings}>
                    <Icon name="alert-circle" size={14} color={colors.UtilityYellow300} />
                    <Text style={[styles.caption1, localStyles.reconnectText]}>{translate('Reconnect email')}</Text>
                </TouchableOpacity>
            ) : (
                <View style={localStyles.chipsRow}>
                    {visible.map(label => (
                        <EmailLabelChip
                            key={`${connection.connectionId}-${label.labelId}`}
                            label={label}
                            projectId={connection.connectionId}
                            provider={connection.provider}
                            emailAddress={emailAddress}
                            labelingDisabled={labelingDisabled}
                            labelOptions={labelOptions}
                        />
                    ))}
                    {overflowCount > 0 && (
                        <TouchableOpacity style={localStyles.overflowChip} onPress={onShowAll}>
                            <Text style={[styles.caption1, localStyles.overflowText]}>{`+${overflowCount}`}</Text>
                        </TouchableOpacity>
                    )}
                </View>
            )}
        </View>
    )
}

// The Email line. With `projectId` it shows the connections whose default project is
// that project (single-project view); without it, ALL email connections merged into one
// line (All Projects). Summaries stay keyed per connection in redux.
export default function EmailLine({ projectId }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const summariesByKey = useSelector(state => state.emailLineSummaryByProject)
    const [showAllChips, setShowAllChips] = useState(false)

    const connections = projectId
        ? getConnectionsForProject(loggedUser, CONNECTION_SERVICE_EMAIL, projectId)
        : listEmailConnections(loggedUser)
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
    const anyAuthExpired = connections.some(
        (connection, index) => summaries[index]?.authExpired || connection.authInvalid
    )
    const inboxZero =
        loadedSummaries.length === connections.length &&
        !anyAuthExpired &&
        loadedSummaries.every(summary => (summary.labels || []).every(label => label.unreadCount === 0))
    const showAccountCaption = connections.length > 1

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

            {inboxZero ? (
                <View style={localStyles.stateRow}>
                    <Text style={[styles.caption1, localStyles.inboxZeroText]}>{translate('Inbox Zero')} 🎉</Text>
                </View>
            ) : (
                connections.map((connection, index) => (
                    <ConnectionChips
                        key={connection.connectionId}
                        connection={connection}
                        summary={summaries[index]}
                        showAccountCaption={showAccountCaption}
                        labelingDisabled={
                            !!summaries[index] &&
                            connection.provider !== 'microsoft' &&
                            summaries[index].labelingEnabled === false
                        }
                        showAllChips={showAllChips}
                        onShowAll={() => setShowAllChips(true)}
                    />
                ))
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
    accountCaption: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 8,
    },
    accountCaptionText: {
        color: colors.Text02,
        flexShrink: 1,
    },
    accountCaptionProvider: {
        color: colors.Text03,
        marginLeft: 6,
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
