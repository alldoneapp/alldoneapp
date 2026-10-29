import React from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import { commentOutbox } from '../../../../utils/backends/Chats/commentOutbox'
import { translate } from '../../../../i18n/TranslationService'
import global, { colors } from '../../../styles/global'
import Icon from '../../../Icon'

export const MESSAGE_QUEUED_LABEL = 'Queued. Sends when the current answer is finished.'

// AT-2922: a queued message waits for the thread's current answer. The user can send it right
// away or withdraw it; outbox entries do that through the outbox, Anna passes its own handlers.
const sendQueuedNow = pendingSend => commentOutbox.update(pendingSend.userId, pendingSend.id, { forceSend: true })
const removeQueued = pendingSend => commentOutbox.remove(pendingSend.userId, pendingSend.id)

export default function MessageSendStatus({
    pendingSend,
    dark = false,
    style,
    label: statusLabel,
    onSendNow,
    onRemove,
}) {
    if (!pendingSend) return null
    const failed = pendingSend.status === 'failed'
    const queued = pendingSend.status === 'queued'
    const color = dark ? colors.Text04 : colors.Text03
    const actionColor = dark ? colors.Text04 : colors.UtilityBlue125
    const label = queued
        ? translate(MESSAGE_QUEUED_LABEL)
        : statusLabel ||
          translate(failed ? 'Comment not synced. Saved on this device.' : 'Saved on this device. Waiting to sync.')
    const action = (text, onPress) => (
        <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`${label} ${translate(text)}`}
            onPress={onPress}
        >
            <Text style={[global.caption2, { marginLeft: 8, color: actionColor }]}>{translate(text)}</Text>
        </TouchableOpacity>
    )
    return (
        <View
            accessibilityLiveRegion="polite"
            accessibilityLabel={label}
            style={[{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }, style]}
        >
            <Icon name={failed ? 'alert-circle' : 'clock'} size={12} color={color} />
            {queued && (
                <>
                    <Text style={[global.caption2, { marginLeft: 4, color }]}>{label}</Text>
                    {action('Send now', () => (onSendNow ? onSendNow() : sendQueuedNow(pendingSend)))}
                    {action('Remove queued message', () => (onRemove ? onRemove() : removeQueued(pendingSend)))}
                </>
            )}
            {failed && (
                <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`${label} ${translate('Retry')}`}
                    onPress={() => commentOutbox.retry(pendingSend.userId, pendingSend.id).catch(() => {})}
                >
                    <Text style={[global.caption2, { marginLeft: 4, color: actionColor }]}>{translate('Retry')}</Text>
                </TouchableOpacity>
            )}
        </View>
    )
}
