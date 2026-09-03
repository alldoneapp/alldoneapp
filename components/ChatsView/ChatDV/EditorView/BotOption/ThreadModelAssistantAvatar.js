import React from 'react'
import { StyleSheet, View } from 'react-native'

import AssistantAvatar from '../../../../AdminPanel/Assistants/AssistantAvatar'
import { colors } from '../../../../styles/global'
import { useThreadAssistantModel } from './threadAssistantModelState'

/**
 * The assistant avatar, badged when this thread runs on a pinned model (AT-2502).
 *
 * A per-thread override is invisible from outside the popup that set it, and an assistant
 * answering on a model other than its configured one — cheaper or dearer, and billed at a
 * different Gold rate — is exactly the kind of state that should not be silent. So the button
 * the user pressed to set it also carries the reminder.
 *
 * It is a dot, not a label: this avatar renders at 24px inside a toolbar and in a detail-view
 * header, and there is no room for "Terra" beside it. The name is one click away in the row that
 * set it. The badge is `pointerEvents: 'none'` so it can never eat the press that opens the
 * popup, and it is drawn at full opacity even while the assistant itself is dimmed — a disabled
 * assistant still has a pinned model, and fading the badge with the avatar would read as the pin
 * being off too.
 */
export default function ThreadModelAssistantAvatar({
    projectId,
    objectId,
    objectType,
    assistantId,
    photoURL,
    size = 24,
    containerStyle,
}) {
    const { model } = useThreadAssistantModel(projectId, objectId, objectType)

    return (
        <View style={localStyles.container}>
            <AssistantAvatar
                photoURL={photoURL}
                assistantId={assistantId}
                size={size}
                containerStyle={containerStyle}
            />
            {!!model && (
                <View
                    accessibilityLabel="thread-model-override"
                    pointerEvents="none"
                    style={[localStyles.badge, { width: badgeSize(size), height: badgeSize(size) }]}
                />
            )}
        </View>
    )
}

// Small enough to stay a hint rather than an icon, but never below 6px or it disappears on a
// standard-density display.
const badgeSize = size => Math.max(6, Math.round(size * 0.33))

const localStyles = StyleSheet.create({
    container: {
        position: 'relative',
        flexDirection: 'row',
        alignItems: 'center',
    },
    badge: {
        position: 'absolute',
        right: -1,
        bottom: -1,
        borderRadius: 100,
        backgroundColor: colors.Primary100,
        borderWidth: 1,
        borderColor: colors.Secondary400,
    },
})
