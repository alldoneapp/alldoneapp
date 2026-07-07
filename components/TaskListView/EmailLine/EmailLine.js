import React, { useEffect, useRef, useState } from 'react'
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'
import NavigationService from '../../../utils/NavigationService'
import SettingsHelper from '../../SettingsView/SettingsHelper'
import { DV_TAB_SETTINGS_INTEGRATIONS } from '../../../utils/TabNavigationConstants'
import { listEmailConnections } from '../../../utils/IntegrationProviders'
import { fetchEmailLineSummary } from '../../../utils/backends/EmailLine/emailLineBackend'
import { setUserEmailLineHiddenTodayForConnections } from '../../../utils/backends/Users/usersFirestore'
import EmailLabelChip from './EmailLabelChip'

import {
    areEmailLineConnectionsHiddenToday,
    getEmailLineTodayKey,
    mergeLabelsAcrossConnections,
    splitChipsForDisplay,
} from './emailLineHelper'

// A gently pulsating green dot shown in the Email header while labeling is
// active, signaling that incoming emails are being parsed in the background.
// The steady core reads as "live"; the halo pings outward and fades to convey
// ongoing activity. Animation is skipped under tests to avoid leaking timers.
function EmailLabelingLiveDot() {
    const pulse = useRef(new Animated.Value(0)).current

    useEffect(() => {
        if (process.env.NODE_ENV === 'test') return undefined
        const animation = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, {
                    toValue: 1,
                    duration: 1600,
                    easing: Easing.out(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
            ])
        )
        animation.start()
        return () => animation.stop()
    }, [pulse])

    const haloOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0] })
    const haloScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 2.1] })

    return (
        <View style={localStyles.liveDot} accessibilityLabel={translate('Email labeling active')}>
            <Animated.View
                style={[localStyles.liveDotHalo, { opacity: haloOpacity, transform: [{ scale: haloScale }] }]}
            />
            <View style={localStyles.liveDotCore} />
        </View>
    )
}

// Ghost chips shown while the first summary is still loading. A few rounded grey
// pills of varying widths gently pulse so the Email line reads as "loading" rather
// than empty. Animation is skipped under tests to avoid leaking timers.
const SKELETON_CHIP_WIDTHS = [88, 116, 72, 100]

function EmailChipsSkeleton() {
    const pulse = useRef(new Animated.Value(0.5)).current

    useEffect(() => {
        if (process.env.NODE_ENV === 'test') return undefined
        const animation = Animated.loop(
            Animated.sequence([
                Animated.timing(pulse, {
                    toValue: 1,
                    duration: 700,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
                Animated.timing(pulse, {
                    toValue: 0.5,
                    duration: 700,
                    easing: Easing.inOut(Easing.ease),
                    useNativeDriver: true,
                }),
            ])
        )
        animation.start()
        return () => animation.stop()
    }, [pulse])

    return (
        <View style={localStyles.chipsRow} accessibilityLabel={translate('Loading emails')}>
            {SKELETON_CHIP_WIDTHS.map((width, index) => (
                <Animated.View key={index} style={[localStyles.skeletonChip, { width, opacity: pulse }]} />
            ))}
        </View>
    )
}

// The unified Email line (All Projects only): ALL connected accounts merged into
// one line, labels grouped by display name across accounts. Summaries stay keyed
// per connection in redux; the merge happens at render time.
export default function EmailLine() {
    const loggedUser = useSelector(state => state.loggedUser)
    const summariesByKey = useSelector(state => state.emailLineSummaryByProject)
    const loadingByKey = useSelector(state => state.emailLineLoadingByProject)
    const mobile = useSelector(state => state.smallScreenNavigation)
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

    // Done for today hides the line completely; it comes back via "Show email
    // line" in the All Projects "..." menu (and automatically the next day).
    if (hiddenToday) return null

    const hideForToday = () => {
        setUserEmailLineHiddenTodayForConnections(loggedUser.uid, connectionIds, getEmailLineTodayKey(loggedUser))
    }

    const reload = () => {
        connectionIds.forEach(connectionId => {
            fetchEmailLineSummary(connectionId, { force: true })
        })
    }

    const openSettings = () => {
        SettingsHelper.processURLSettingsTab(NavigationService, DV_TAB_SETTINGS_INTEGRATIONS)
    }

    const summaries = connections.map(connection => summariesByKey[connection.connectionId])
    const loadedSummaries = summaries.filter(Boolean)
    // Any account whose labeling classifier is enabled means emails are being
    // parsed in the background — surface that as the live dot in the header.
    const labelingActive = loadedSummaries.some(summary => summary.labelingEnabled === true)
    const expiredConnections = connections.filter(
        (connection, index) => summaries[index]?.authExpired || connection.authInvalid
    )

    const groups = mergeLabelsAcrossConnections(connections, summariesByKey)
    // A sweeping group stays visible (with a spinner) even though its count was
    // optimistically zeroed.
    const visibleGroups = groups.filter(group => group.threadCount > 0 || group.sweeping)
    const inboxZero =
        loadedSummaries.length === connections.length && expiredConnections.length === 0 && visibleGroups.length === 0
    // First-time load: nothing cached in redux yet and a fetch is in flight. Show
    // ghost chips instead of an empty line so the section doesn't look broken.
    const isInitialLoading = loadedSummaries.length === 0 && connectionIds.some(id => loadingByKey[id])
    const { visible, overflowCount } = splitChipsForDisplay(visibleGroups, showAllChips)

    const labelOptionsByConnectionId = {}
    const labelingDisabledByConnectionId = {}
    connections.forEach(connection => {
        const summary = summariesByKey[connection.connectionId]
        // Use the summary's full labelOptions (every configured label, not just ones with current
        // threads) so feedback can move an email to any label. Each option carries `gmailLabelName`
        // for the server to resolve/create the label, and `displayName` for the UI. Older cached
        // summaries stored plain-name strings, so normalize those too.
        labelOptionsByConnectionId[connection.connectionId] = (summary?.labelOptions || [])
            .map(option =>
                typeof option === 'string'
                    ? { gmailLabelName: option, displayName: option }
                    : { gmailLabelName: option?.gmailLabelName, displayName: option?.displayName }
            )
            .filter(option => option.gmailLabelName && option.displayName)
        labelingDisabledByConnectionId[connection.connectionId] =
            !!summary && connection.provider !== 'microsoft' && summary.labelingEnabled === false
    })

    return (
        <View style={localStyles.container}>
            <View style={localStyles.header}>
                <View style={localStyles.headerLeft}>
                    <Icon name="mail" size={14} color={colors.Text03} style={localStyles.headerIcon} />
                    <Text style={[styles.caption1, localStyles.headerText]}>{translate('Email')}</Text>
                    {labelingActive && <EmailLabelingLiveDot />}
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
                        accessibilityLabel={translate('Settings')}
                    >
                        <Icon name="settings" size={14} color={colors.Text03} />
                    </TouchableOpacity>
                </View>
                <View style={localStyles.headerRight}>
                    <TouchableOpacity
                        style={[localStyles.doneButton, mobile && localStyles.doneButtonMobile]}
                        onPress={hideForToday}
                        accessibilityLabel={translate('Done for today')}
                    >
                        <Icon
                            name="check"
                            size={12}
                            color={colors.Text03}
                            style={mobile ? undefined : localStyles.doneIcon}
                        />
                        {!mobile && (
                            <Text style={[styles.caption1, localStyles.doneText]}>{translate('Done for today')}</Text>
                        )}
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

            {isInitialLoading ? (
                <EmailChipsSkeleton />
            ) : inboxZero ? (
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
        paddingBottom: 20,
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
    headerRight: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-end',
    },
    headerIcon: {
        marginRight: 6,
    },
    headerText: {
        color: colors.Text03,
        marginRight: 8,
    },
    liveDot: {
        width: 14,
        height: 14,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 8,
    },
    liveDotHalo: {
        position: 'absolute',
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: colors.UtilityGreen200,
    },
    liveDotCore: {
        width: 7,
        height: 7,
        borderRadius: 3.5,
        backgroundColor: colors.UtilityGreen200,
    },
    iconButton: {
        height: 22,
        paddingHorizontal: 2,
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 8,
    },
    doneButton: {
        height: 24,
        paddingHorizontal: 12,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.Grey400,
        backgroundColor: '#ffffff',
        flexDirection: 'row',
        alignItems: 'center',
    },
    doneButtonMobile: {
        width: 24,
        paddingHorizontal: 0,
        justifyContent: 'center',
    },
    doneIcon: {
        marginRight: 6,
    },
    doneText: {
        color: colors.Text03,
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
    skeletonChip: {
        height: 24,
        borderRadius: 12,
        backgroundColor: colors.Grey300,
        marginRight: 8,
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
