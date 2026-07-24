import React, { useEffect, useMemo } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { shallowEqual, useSelector } from 'react-redux'

import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { getUnreadThreadCount } from './Utils/unreadChatFilter'

export default function ChatFiltersLine({ projectIds, unreadOnly, setUnreadOnly }) {
    const chatsActiveTab = useSelector(state => state.chatsActiveTab)
    const projectChatNotifications = useSelector(state => state.projectChatNotifications, shallowEqual)
    const unreadCount = useMemo(() => getUnreadThreadCount(projectChatNotifications, projectIds, chatsActiveTab), [
        projectChatNotifications,
        projectIds,
        chatsActiveTab,
    ])

    useEffect(() => {
        if (unreadCount === 0 && unreadOnly) setUnreadOnly(false)
    }, [unreadCount, unreadOnly])

    if (unreadCount === 0) return null

    return (
        <View style={localStyles.container} testID="chat-filters">
            <View style={localStyles.header}>
                <Icon name="filter" size={14} color={colors.Text03} style={localStyles.headerIcon} />
                <Text style={[styles.caption1, localStyles.headerText]}>{translate('Chat Filters')}</Text>
                {unreadOnly && (
                    <View style={localStyles.activeCount} testID="chat-filter-active-count">
                        <Text style={localStyles.activeCountText}>1</Text>
                    </View>
                )}
            </View>
            <View style={localStyles.filtersRow}>
                <FilterChip
                    selected={!unreadOnly}
                    onPress={() => setUnreadOnly(false)}
                    testID="chat-filter-all"
                    label={translate('All')}
                />
                <FilterChip
                    selected={unreadOnly}
                    onPress={() => setUnreadOnly(true)}
                    testID="chat-filter-unread"
                    label={translate('Unread')}
                    count={unreadCount}
                />
            </View>
        </View>
    )
}

function FilterChip({ selected, onPress, testID, label, count }) {
    return (
        <TouchableOpacity
            style={[localStyles.filterItem, selected && localStyles.filterItemSelected]}
            onPress={onPress}
            testID={testID}
        >
            <Text style={[localStyles.filterName, selected && localStyles.filterNameSelected]}>{label}</Text>
            {count !== undefined && (
                <Text style={[localStyles.filterCount, selected && localStyles.filterCountSelected]}>{count}</Text>
            )}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: { marginTop: 8, marginBottom: 8 },
    header: { minHeight: 24, flexDirection: 'row', alignItems: 'center' },
    headerIcon: { marginRight: 6 },
    headerText: { flex: 1, color: colors.Text03, marginRight: 8 },
    activeCount: {
        minWidth: 20,
        height: 20,
        borderRadius: 10,
        paddingHorizontal: 6,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.Primary200,
        marginRight: 8,
    },
    activeCountText: { ...styles.caption2, color: 'white' },
    filtersRow: { flexDirection: 'row', flexWrap: 'nowrap', alignItems: 'center', marginTop: 8 },
    filterItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Grey200,
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 4,
        marginRight: 8,
        marginBottom: 8,
    },
    filterItemSelected: { backgroundColor: colors.Primary200 },
    filterName: { ...styles.caption1, color: colors.Text03 },
    filterNameSelected: { color: 'white' },
    filterCount: { ...styles.caption2, color: colors.Text03, marginLeft: 6 },
    filterCountSelected: { color: 'white' },
})
