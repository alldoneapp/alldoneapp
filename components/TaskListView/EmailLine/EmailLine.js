import React, { useEffect, useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import NavigationService from '../../../utils/NavigationService'
import { DV_TAB_PROJECT_PROPERTIES } from '../../../utils/TabNavigationConstants'
import { resolveEmailConnection } from '../../../utils/IntegrationProviders'
import { fetchEmailLineSummary } from '../../../utils/backends/EmailLine/emailLineBackend'
import {
    setUserEmailLineHiddenToday,
    clearUserEmailLineHiddenToday,
} from '../../../utils/backends/Users/usersFirestore'
import EmailLabelChip from './EmailLabelChip'
import { getEmailLineTodayKey, isEmailLineHiddenToday, splitChipsForDisplay } from './emailLineHelper'

export default function EmailLine({ projectId, inAllProjects }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const connection = resolveEmailConnection(loggedUser.apisConnected?.[projectId])
    const summary = useSelector(state => state.emailLineSummaryByProject[projectId])
    const [showAllChips, setShowAllChips] = useState(false)

    const hiddenToday = isEmailLineHiddenToday(loggedUser, projectId)

    useEffect(() => {
        if (connection.connected && projectId) {
            fetchEmailLineSummary(projectId)
        }
    }, [projectId, connection.connected])

    if (!connection.connected) return null

    const hideForToday = () => {
        setUserEmailLineHiddenToday(loggedUser.uid, projectId, getEmailLineTodayKey(loggedUser))
    }

    const showAgain = () => {
        clearUserEmailLineHiddenToday(loggedUser.uid, projectId)
    }

    const reload = () => {
        fetchEmailLineSummary(projectId, { force: true })
    }

    const openReconnect = () => {
        ProjectHelper.processURLProjectDetailsTab(NavigationService, DV_TAB_PROJECT_PROPERTIES, projectId)
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

    const emailAddress = summary?.emailAddress || connection.email
    const unreadLabels = (summary?.labels || []).filter(label => label.unreadCount > 0)
    const { visible, overflowCount } = splitChipsForDisplay(unreadLabels, showAllChips)
    const authExpired = summary?.authExpired
    const inboxZero = !!summary && !authExpired && unreadLabels.length === 0

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

            {authExpired && (
                <TouchableOpacity style={localStyles.stateRow} onPress={openReconnect}>
                    <Icon name="alert-circle" size={14} color={colors.UtilityYellow300} />
                    <Text style={[styles.caption1, localStyles.reconnectText]}>{translate('Reconnect email')}</Text>
                </TouchableOpacity>
            )}

            {!authExpired && inboxZero && (
                <View style={localStyles.stateRow}>
                    <Text style={[styles.caption1, localStyles.inboxZeroText]}>{translate('Inbox Zero')} 🎉</Text>
                </View>
            )}

            {!authExpired && !inboxZero && unreadLabels.length > 0 && (
                <View style={localStyles.chipsRow}>
                    {visible.map(label => (
                        <EmailLabelChip
                            key={label.labelId}
                            label={label}
                            projectId={projectId}
                            provider={connection.provider}
                            emailAddress={emailAddress}
                        />
                    ))}
                    {overflowCount > 0 && (
                        <TouchableOpacity style={localStyles.overflowChip} onPress={() => setShowAllChips(true)}>
                            <Text style={[styles.caption1, localStyles.overflowText]}>{`+${overflowCount}`}</Text>
                        </TouchableOpacity>
                    )}
                </View>
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
