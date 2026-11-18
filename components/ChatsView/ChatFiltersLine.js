import React, { useEffect, useMemo } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { shallowEqual, useSelector } from 'react-redux'

import Icon from '../Icon'
import styles, { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'
import { getUnreadMessageCount } from './Utils/unreadChatFilter'
import { UnreadTriageTagChips, UnreadTriageTools } from './UnreadTriage/UnreadTriageFilters'
import { useUnreadTriage } from './UnreadTriage/UnreadTriageContext'
import { UNREAD_TAG_ALL } from './UnreadTriage/unreadMessageTags'

export default function ChatFiltersLine({ projectIds, unreadOnly, setUnreadOnly }) {
    const chatsActiveTab = useSelector(state => state.chatsActiveTab)
    const projectChatNotifications = useSelector(state => state.projectChatNotifications, shallowEqual)
    const unreadCount = useMemo(
        () => getUnreadMessageCount(projectChatNotifications, projectIds, chatsActiveTab),
        [projectChatNotifications, projectIds, chatsActiveTab]
    )

    // The unread list's tag filter lives in the same row: "Unread" is every tag, a tag chip one of
    // them, and leaving or re-entering Unread starts from every tag again.
    const triage = useUnreadTriage()
    const tagFilter = triage?.tagFilter || UNREAD_TAG_ALL
    const resetTagFilter = () => triage?.setTagFilter(UNREAD_TAG_ALL)
    const showAll = () => {
        resetTagFilter()
        setUnreadOnly(false)
    }
    const showUnread = () => {
        resetTagFilter()
        setUnreadOnly(true)
    }

    useEffect(() => {
        if (unreadCount === 0 && unreadOnly) setUnreadOnly(false)
    }, [unreadCount, unreadOnly])

    if (unreadCount === 0) return null

    return (
        <View style={localStyles.container} testID="chat-filters">
            <View style={localStyles.header}>
                <Icon name="filter" size={14} color={colors.Text03} style={localStyles.headerIcon} />
                <Text style={[styles.caption1, localStyles.headerText]}>{translate('Chat Filters')}</Text>
            </View>
            <View style={localStyles.filtersRow}>
                <View style={localStyles.chips}>
                    <FilterChip
                        selected={!unreadOnly}
                        onPress={showAll}
                        testID="chat-filter-all"
                        label={translate('All')}
                    />
                    <FilterChip
                        selected={unreadOnly && tagFilter === UNREAD_TAG_ALL}
                        onPress={showUnread}
                        testID="chat-filter-unread"
                        label={translate('Unread')}
                        count={unreadCount}
                    />
                    {/* Chats > Unread is the flat list of unread messages: its tags, in this row. */}
                    {unreadOnly && <UnreadTriageTagChips projectIds={projectIds} />}
                </View>
                {unreadOnly && <UnreadTriageTools />}
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
    filtersRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 8 },
    chips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
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
