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

/**
 * Second filter row of Chats > Unread: one chip per tag with its count across the shown projects,
 * the sort (newest / sender) and the newsletter and ads setting. A tag with nothing unread is
 * hidden unless it is the selected one, so the user can always switch back.
 */
export default function UnreadTriageFilters({ projectIds }) {
    const triage = useUnreadTriage()
    const [settingsOpen, setSettingsOpen] = useState(false)
    if (!triage) return null

    const { tagFilter, setTagFilter, sortMode, setSortMode, projects } = triage
    const counts = sumTagCounts(projects, projectIds)
    const tags = [UNREAD_TAG_ALL, ...UNREAD_TAG_ORDER.filter(tag => counts[tag] > 0 || tag === tagFilter)]
    const sortBySender = sortMode === UNREAD_SORT_SENDER

    return (
        <View style={localStyles.container} testID="unread-triage-filters">
            <View style={localStyles.chips}>
                {tags.map(tag => (
                    <TouchableOpacity
                        key={tag}
                        style={[localStyles.chip, tag === tagFilter && localStyles.chipSelected]}
                        onPress={() => setTagFilter(tag)}
                        testID={`unread-tag-${tag}`}
                    >
                        <Text style={[localStyles.chipText, tag === tagFilter && localStyles.chipTextSelected]}>
                            {translate(UNREAD_TAG_LABEL_KEYS[tag])}
                        </Text>
                        <Text style={[localStyles.chipCount, tag === tagFilter && localStyles.chipTextSelected]}>
                            {counts[tag] || 0}
                        </Text>
                    </TouchableOpacity>
                ))}
            </View>
            <View style={localStyles.tools}>
                <TouchableOpacity
                    style={[localStyles.chip, sortBySender && localStyles.chipSelected]}
                    onPress={() => setSortMode(sortBySender ? UNREAD_SORT_NEWEST : UNREAD_SORT_SENDER)}
                    accessibilityLabel={translate(sortBySender ? 'Sorted by sender' : 'Sorted by newest')}
                    testID="unread-sort"
                >
                    <Icon
                        name="sort-list"
                        size={14}
                        color={sortBySender ? '#ffffff' : colors.Text03}
                        style={localStyles.chipIcon}
                    />
                    <Text style={[localStyles.chipText, sortBySender && localStyles.chipTextSelected]}>
                        {translate(sortBySender ? 'Sender' : 'Newest')}
                    </Text>
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
                        style={localStyles.settingsButton}
                        onPress={() => setSettingsOpen(true)}
                        accessibilityLabel={translate('Newsletters and ads')}
                        testID="unread-email-settings-button"
                    >
                        <Icon name="sliders" size={16} color={colors.Text03} />
                    </TouchableOpacity>
                </AppPopover>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        marginBottom: 8,
    },
    chips: {
        flex: 1,
        flexDirection: 'row',
        flexWrap: 'wrap',
        alignItems: 'center',
    },
    tools: {
        flexDirection: 'row',
        alignItems: 'center',
        flexShrink: 0,
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
    chipIcon: {
        marginRight: 4,
    },
    settingsButton: {
        width: 28,
        height: 28,
        alignItems: 'center',
        justifyContent: 'center',
        marginBottom: 8,
    },
})
