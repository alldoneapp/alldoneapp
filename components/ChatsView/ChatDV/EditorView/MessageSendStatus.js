import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { commentOutbox } from '../../../../utils/backends/Chats/commentOutbox'
import { translate } from '../../../../i18n/TranslationService'
import global, { colors } from '../../../styles/global'
import Icon from '../../../Icon'

export const MESSAGE_QUEUED_LABEL = 'Queued. Sends when the current answer is finished.'

// AT-2922: a queued message waits for the thread's current answer. The user can send it right
// away or withdraw it; outbox entries do that through the outbox, Anna passes its own handlers.
//
// AT-2927: react-native-web gives every View `flex-shrink: 0`, so in a header row the status
// used to keep its single-line width and run past the right edge of the message, where the
// chat clips it, squeezing the author name to nothing and hiding Send now / Remove. The status
// therefore shrinks and its label wraps. `prominent` renders the queued note as a block of its
// own (Anna places it on its own line under the author row), readable rather than a caption.
// AT-3037: the task comment popup (`Comment`, `dark`) does the same; its header row has a fixed
// height, so an inline queued note that wrapped overflowed it and lay over the comment text.
const sendQueuedNow = pendingSend => commentOutbox.update(pendingSend.userId, pendingSend.id, { forceSend: true })
const removeQueued = pendingSend => commentOutbox.remove(pendingSend.userId, pendingSend.id)

export default function MessageSendStatus({
    pendingSend,
    dark = false,
    style,
    label: statusLabel,
    onSendNow,
    onRemove,
    prominent = false,
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
    const action = (text, onPress, textStyle) => (
        <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`${label} ${translate(text)}`}
            onPress={onPress}
        >
            <Text style={textStyle || [global.caption2, { marginLeft: 8, color: actionColor }]}>{translate(text)}</Text>
        </TouchableOpacity>
    )
    const sendNow = () => (onSendNow ? onSendNow() : sendQueuedNow(pendingSend))
    const remove = () => (onRemove ? onRemove() : removeQueued(pendingSend))
    if (queued && prominent) {
        // Icon beside a column, never a wrapping row: in a wrapping row a long label would drop
        // to its own line and leave the icon alone above it.
        return (
            <View
                accessibilityLiveRegion="polite"
                accessibilityLabel={label}
                style={[localStyles.note, dark && localStyles.noteDark, style]}
            >
                <View style={localStyles.noteIcon}>
                    <Icon name="clock" size={14} color={dark ? colors.UtilityBlue125 : colors.Primary100} />
                </View>
                <View style={localStyles.noteBody}>
                    <Text style={[global.caption1, localStyles.noteLabel, dark && localStyles.noteLabelDark]}>
                        {label}
                    </Text>
                    <View style={localStyles.noteActions}>
                        {action('Send now', sendNow, [
                            global.caption1,
                            localStyles.noteAction,
                            dark && localStyles.noteActionDark,
                        ])}
                        {action('Remove queued message', remove, [
                            global.caption1,
                            localStyles.noteAction,
                            dark && localStyles.noteActionDark,
                        ])}
                    </View>
                </View>
            </View>
        )
    }
    return (
        <View accessibilityLiveRegion="polite" accessibilityLabel={label} style={[localStyles.inline, style]}>
            <Icon name={failed ? 'alert-circle' : 'clock'} size={12} color={color} />
            {queued && (
                <>
                    <Text style={[global.caption2, localStyles.inlineLabel, { color }]}>{label}</Text>
                    {action('Send now', sendNow)}
                    {action('Remove queued message', remove)}
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

const localStyles = StyleSheet.create({
    inline: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', flexShrink: 1, minWidth: 0 },
    inlineLabel: { marginLeft: 4, flexShrink: 1, minWidth: 0 },
    note: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        alignSelf: 'stretch',
        minWidth: 0,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 8,
        backgroundColor: colors.UtilityBlue100,
        borderWidth: 1,
        borderColor: colors.UtilityBlue125,
    },
    noteIcon: { marginTop: 3, marginRight: 8 },
    noteBody: { flex: 1, flexShrink: 1, minWidth: 0 },
    noteLabel: { color: colors.Text01 },
    noteActions: { flexDirection: 'row', flexWrap: 'wrap' },
    noteAction: { color: colors.Primary100, marginRight: 16 },
    // AT-3037: `dark` callers sit on a popup card (navy in light mode, the raised neutral card in
    // dark mode), whose content keeps the light palette: a light blue tint there would be a bright
    // block on a dark card, so the note uses the popup's own raised surface and light text tokens.
    noteDark: { backgroundColor: colors.Secondary300, borderColor: colors.Secondary200 },
    noteLabelDark: { color: colors.Grey400 },
    noteActionDark: { color: colors.UtilityBlue125 },
})
