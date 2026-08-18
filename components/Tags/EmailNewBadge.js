import React from 'react'
import { StyleSheet, View } from 'react-native'

import { translate } from '../../i18n/TranslationService'
import { colors } from '../styles/global'

/**
 * Marks an email-backed comment as not yet read (AT-2366).
 *
 * Deliberately text-free: a plain grey dot, sized like every other unread/new dot in the app
 * (`NewFeedDot`, the red `dotNotification` in the chat message header) so the marker reads as an
 * indicator rather than as another word competing with the sender name and timestamp next to it.
 * The `New` label survives as `accessibilityLabel`, so dropping the visible text costs nothing for
 * screen readers — the dot is still announced exactly as the pill was.
 */
export default function EmailNewBadge({ propStyles }) {
    return (
        <View style={[localStyles.badge, propStyles]} accessibilityLabel={translate('New')} testID="email-new-badge" />
    )
}

const localStyles = StyleSheet.create({
    badge: {
        width: 6,
        height: 6,
        borderRadius: 100,
        backgroundColor: colors.Gray500,
        flexShrink: 0,
    },
})
