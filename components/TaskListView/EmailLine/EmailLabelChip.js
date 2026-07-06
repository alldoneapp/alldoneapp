import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'

import styles, { colors } from '../../styles/global'
import EmailLabelModal from './EmailLabelModal/EmailLabelModal'

const POPOVER_CONTAINER_STYLE = { zIndex: 9999 }

// A single label/folder pill with its unread count. Tapping it opens a modal
// listing the inbox emails carrying that label.
export default function EmailLabelChip({ label, projectId, provider, emailAddress }) {
    const [isOpen, setIsOpen] = useState(false)
    const smallScreen = useSelector(state => state.smallScreen)
    if (!label) return null
    const hasUnread = label.unreadCount > 0

    const trigger = (
        <TouchableOpacity
            style={localStyles.chip}
            onPress={() => setIsOpen(true)}
            accessibilityLabel={`${label.displayName}: ${label.unreadCount}`}
        >
            <Text style={[styles.caption1, localStyles.name, hasUnread && localStyles.nameActive]} numberOfLines={1}>
                {label.displayName}
            </Text>
            {hasUnread && (
                <View style={localStyles.badge}>
                    <Text style={[styles.caption2, localStyles.badgeText]}>{label.unreadCount}</Text>
                </View>
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
            onClickOutside={() => setIsOpen(false)}
            contentLocation={smallScreen ? null : undefined}
            content={
                <EmailLabelModal
                    projectId={projectId}
                    label={label}
                    provider={provider}
                    emailAddress={emailAddress}
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
        borderColor: colors.Grey400,
        backgroundColor: '#ffffff',
        flexDirection: 'row',
        alignItems: 'center',
        marginRight: 8,
        marginBottom: 8,
    },
    name: {
        color: colors.Text03,
        flexShrink: 1,
    },
    nameActive: {
        color: colors.Text01,
    },
    badge: {
        minWidth: 18,
        height: 18,
        paddingHorizontal: 5,
        borderRadius: 9,
        marginLeft: 6,
        backgroundColor: colors.Primary100,
        alignItems: 'center',
        justifyContent: 'center',
    },
    badgeText: {
        color: '#ffffff',
    },
})
