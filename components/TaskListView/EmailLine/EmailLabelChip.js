import React, { useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import EmailLabelModal from './EmailLabelModal/EmailLabelModal'
import { shouldIgnoreEmailLabelModalDismiss } from './emailLineHelper'

const POPOVER_CONTAINER_STYLE = { zIndex: 9999 }

// A single merged label/folder pill with its inbox thread count summed across all
// accounts carrying that label. Tapping it opens a modal listing the matching inbox
// emails of every account, grouped by account.
export default function EmailLabelChip({
    group,
    allGroups,
    labelOptionsByConnectionId,
    labelingDisabledByConnectionId,
    style,
    compact = false,
}) {
    const [isOpen, setIsOpen] = useState(false)
    const smallScreen = useSelector(state => state.smallScreen)
    const mobile = useSelector(state => state.smallScreenNavigation)
    if (!group) return null
    // On the tight header lines (compact chips) mobile drops the label name and keeps just the
    // mail icon + count. The full-width standalone Email line keeps its names so labels stay
    // distinguishable.
    const iconOnly = compact && mobile

    const trigger = (
        <TouchableOpacity
            style={[localStyles.chip, compact && localStyles.chipCompact, iconOnly && localStyles.chipIconOnly, style]}
            onPress={() => setIsOpen(true)}
            accessibilityLabel={`${group.displayName}: ${group.threadCount}`}
        >
            <Icon
                name="mail"
                size={13}
                color={colors.Text03}
                style={[localStyles.mailIcon, iconOnly && localStyles.mailIconOnly]}
            />
            {!iconOnly && (
                <Text style={[styles.caption1, localStyles.name]} numberOfLines={1}>
                    {group.displayName}
                </Text>
            )}
            {group.sweeping ? (
                <ActivityIndicator size="small" color={colors.Primary100} style={localStyles.sweepSpinner} />
            ) : (
                group.threadCount > 0 && (
                    <View style={[localStyles.badge, compact && localStyles.badgeCompact]}>
                        <Text style={[styles.caption2, localStyles.badgeText]}>{group.threadCount}</Text>
                    </View>
                )
            )}
        </TouchableOpacity>
    )

    return (
        <Popover
            isOpen={isOpen}
            position={['bottom', 'top', 'right', 'left']}
            align="start"
            padding={4}
            containerStyle={POPOVER_CONTAINER_STYLE}
            onClickOutside={() => {
                // Selecting an option in the nested label-options popover reads as an outside click
                // here (it lives in a separate portal); ignore it so picking a label keeps the modal
                // open. Genuine outside taps still dismiss.
                if (!shouldIgnoreEmailLabelModalDismiss()) setIsOpen(false)
            }}
            contentLocation={smallScreen ? null : undefined}
            content={
                <EmailLabelModal
                    group={group}
                    allGroups={allGroups}
                    labelOptionsByConnectionId={labelOptionsByConnectionId}
                    labelingDisabledByConnectionId={labelingDisabledByConnectionId}
                    closePopover={() => setIsOpen(false)}
                />
            }
        >
            {trigger}
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    chip: {
        height: 24,
        maxWidth: 180,
        paddingLeft: 10,
        paddingRight: 6,
        borderRadius: 12,
        borderWidth: 1,
        // Use the same outline color as the project-line "Add task" control.
        borderColor: colors.Text03,
        backgroundColor: '#ffffff',
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 8,
        marginBottom: 8,
    },
    chipCompact: {
        maxWidth: 140,
        paddingLeft: 6,
        paddingRight: 4,
        // Match the header "Add task" button's transparent treatment.
        backgroundColor: 'transparent',
    },
    chipIconOnly: {
        // No label text — just the mail icon + count, so the pill hugs its content.
        maxWidth: undefined,
    },
    mailIcon: {
        marginRight: 6,
    },
    mailIconOnly: {
        // Label text is hidden, so the count badge follows the icon directly.
        marginRight: 0,
    },
    name: {
        color: colors.Text03,
        flexShrink: 1,
    },
    badge: {
        minWidth: 18,
        height: 18,
        paddingHorizontal: 5,
        borderRadius: 9,
        marginLeft: 6,
        backgroundColor: colors.Grey300,
        alignItems: 'center',
        justifyContent: 'center',
    },
    badgeCompact: {
        minWidth: 16,
        height: 16,
        paddingHorizontal: 4,
        borderRadius: 8,
        marginLeft: 4,
    },
    badgeText: {
        color: colors.Text02,
    },
    sweepSpinner: {
        marginLeft: 6,
        transform: [{ scale: 0.7 }],
    },
})
