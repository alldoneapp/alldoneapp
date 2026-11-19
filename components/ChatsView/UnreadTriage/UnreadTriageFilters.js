import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import AppPopover from '../../UIComponents/ModalShell/AppPopover'
import { translate } from '../../../i18n/TranslationService'
import { sumTagCounts, useUnreadTriage } from './UnreadTriageContext'
import UnreadEmailSettingsPopup from './UnreadEmailSettingsPopup'
import {
    UNREAD_SORT_NEWEST,
    UNREAD_SORT_SENDER,
    UNREAD_TAG_ALL,
    UNREAD_TAG_LABEL_KEYS,
    UNREAD_TAG_ORDER,
} from './unreadMessageTags'

// Chats > Unread keeps its filters in the one chat filter row (decided 2026-11-18, no second row):
// "All | Unread N", then these tag chips, and the sort and settings icons at the right end.

/**
 * One chip per tag with its count across the shown projects. "Unread" itself is the "all tags"
 * choice, so there is no separate "All" tag chip. A tag with nothing unread is hidden unless it is
 * the selected one, so the user can always switch back.
 */
export function UnreadTriageTagChips({ projectIds }) {
    const triage = useUnreadTriage()
    if (!triage) return null

    const { tagFilter, setTagFilter, projects } = triage
    const counts = sumTagCounts(projects, projectIds)
    const tags = UNREAD_TAG_ORDER.filter(tag => counts[tag] > 0 || tag === tagFilter)
    if (tags.length === 0) return null

    return (
        <>
            <View style={localStyles.divider} />
            {tags.map(tag => {
                const selected = tag === tagFilter
                return (
                    <TouchableOpacity
                        key={tag}
                        style={[localStyles.chip, selected && localStyles.chipSelected]}
                        onPress={() => setTagFilter(selected ? UNREAD_TAG_ALL : tag)}
                        testID={`unread-tag-${tag}`}
                    >
                        <Text style={[localStyles.chipText, selected && localStyles.chipTextSelected]}>
                            {translate(UNREAD_TAG_LABEL_KEYS[tag])}
                        </Text>
                        <Text style={[localStyles.chipCount, selected && localStyles.chipTextSelected]}>
                            {counts[tag] || 0}
                        </Text>
                    </TouchableOpacity>
                )
            })}
        </>
    )
}

/** The sort (newest / sender) and the newsletter and ads setting, as icons. */
export function UnreadTriageTools() {
    const triage = useUnreadTriage()
    const [settingsOpen, setSettingsOpen] = useState(false)
    if (!triage) return null

    const { sortMode, setSortMode } = triage
    const sortBySender = sortMode === UNREAD_SORT_SENDER
    const sortLabel = translate(sortBySender ? 'Sorted by sender' : 'Sorted by newest')

    return (
        <View style={localStyles.tools} testID="unread-triage-tools">
            <TouchableOpacity
                style={[localStyles.toolButton, sortBySender && localStyles.toolButtonActive]}
                onPress={() => setSortMode(sortBySender ? UNREAD_SORT_NEWEST : UNREAD_SORT_SENDER)}
                accessibilityLabel={sortLabel}
                accessibilityRole="button"
                testID="unread-sort"
            >
                <Icon name="sort-list" size={16} color={sortBySender ? colors.Primary100 : colors.Text03} />
            </TouchableOpacity>
            <AppPopover
                isOpen={settingsOpen}
                onClickOutside={() => setSettingsOpen(false)}
                position={['bottom', 'left', 'top']}
                align="end"
                padding={4}
                content={<UnreadEmailSettingsPopup closePopover={() => setSettingsOpen(false)} />}
            >
                <TouchableOpacity
                    style={localStyles.toolButton}
                    onPress={() => setSettingsOpen(true)}
                    accessibilityLabel={translate('Newsletters and ads')}
                    accessibilityRole="button"
                    testID="unread-email-settings-button"
                >
                    <Icon name="sliders" size={16} color={colors.Text03} />
                </TouchableOpacity>
            </AppPopover>
        </View>
    )
}

const localStyles = StyleSheet.create({
    divider: {
        width: 1,
        height: 16,
        backgroundColor: colors.Grey400,
        marginRight: 8,
        marginBottom: 8,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: colors.Grey200,
        borderRadius: 12,
        paddingHorizontal: 10,
        paddingVertical: 4,
        marginRight: 8,
        marginBottom: 8,
    },
    chipSelected: {
        backgroundColor: colors.Primary200,
    },
    chipText: {
        ...styles.caption1,
        color: colors.Text03,
    },
    chipCount: {
        ...styles.caption2,
        color: colors.Text03,
        marginLeft: 6,
    },
    chipTextSelected: {
        color: '#ffffff',
    },
    tools: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 0,
        marginBottom: 8,
    },
    toolButton: {
        width: 28,
        height: 28,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 4,
    },
    toolButtonActive: {
        backgroundColor: colors.UtilityBlue100,
    },
})
