import React from 'react'
import { Text, TouchableOpacity, View } from 'react-native'
import { commentOutbox } from '../../../../utils/backends/Chats/commentOutbox'
import { translate } from '../../../../i18n/TranslationService'
import global, { colors } from '../../../styles/global'
import Icon from '../../../Icon'

export default function MessageSendStatus({ pendingSend, dark = false, style, label: statusLabel }) {
    if (!pendingSend) return null
    const failed = pendingSend.status === 'failed'
    const color = dark ? colors.Text04 : colors.Text03
    const label =
        statusLabel ||
        translate(failed ? 'Comment not synced. Saved on this device.' : 'Saved on this device. Waiting to sync.')
    return (
        <View
            accessibilityLiveRegion="polite"
            accessibilityLabel={label}
            style={[{ flexDirection: 'row', alignItems: 'center' }, style]}
        >
            <Icon name={failed ? 'alert-circle' : 'clock'} size={12} color={color} />
            {failed && (
                <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`${label} ${translate('Retry')}`}
                    onPress={() => commentOutbox.retry(pendingSend.userId, pendingSend.id).catch(() => {})}
                >
                    <Text
                        style={[
                            global.caption2,
                            { marginLeft: 4, color: dark ? colors.Text04 : colors.UtilityBlue125 },
                        ]}
                    >
                        {translate('Retry')}
                    </Text>
                </TouchableOpacity>
            )}
        </View>
    )
}
