import React, { useEffect, useState } from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'
import { commentOutbox, subscribeCommentOutbox } from '../../../../utils/backends/Chats/commentOutbox'
import { translate } from '../../../../i18n/TranslationService'
import { colors } from '../../../styles/global'

export default function PendingCommentSends({ projectId, objectId, objectType, dark = false }) {
    const userId = useSelector(state => state.loggedUser?.uid)
    const [, refresh] = useState(0)
    useEffect(() => subscribeCommentOutbox(() => refresh(value => value + 1)), [])
    const entries = commentOutbox
        .list(userId)
        .filter(
            entry =>
                entry.projectId === projectId &&
                entry.objectId === objectId &&
                (entry.objectType === objectType ||
                    (['users', 'contacts'].includes(entry.objectType) && ['users', 'contacts'].includes(objectType)))
        )
    if (!entries.length) return null
    const color = dark ? '#ffffff' : colors.Text02
    return (
        <View accessibilityLiveRegion="polite" style={{ padding: 12 }}>
            {entries.map(entry => (
                <View key={entry.id} style={{ marginBottom: 8 }}>
                    <Text style={{ color }} selectable>
                        {entry.comment}
                    </Text>
                    <Text style={{ color, fontSize: 12 }}>
                        {translate(
                            entry.status === 'failed'
                                ? 'Comment not synced. Saved on this device.'
                                : 'Saved on this device. Waiting to sync.'
                        )}
                    </Text>
                    {entry.status === 'failed' && (
                        <TouchableOpacity
                            accessibilityRole="button"
                            onPress={() => commentOutbox.retry(userId, entry.id).catch(() => {})}
                        >
                            <Text style={{ color: dark ? '#ffffff' : colors.UtilityBlue125 }}>
                                {translate('Retry')}
                            </Text>
                        </TouchableOpacity>
                    )}
                </View>
            ))}
        </View>
    )
}
