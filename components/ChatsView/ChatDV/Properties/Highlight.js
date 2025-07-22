import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import Icon from '../../../Icon'
import styles, { colors } from '../../../styles/global'
import HighlightButton from '../../../UIComponents/FloatModals/HighlightColorModal/HighlightButton'
import { FEED_CHAT_OBJECT_TYPE } from '../../../Feeds/Utils/FeedsConstants'
import { translate } from '../../../../i18n/TranslationService'

export default function Highlight({ projectId, chat, disabled }) {
    return (
        <View style={localStyles.container}>
            <View style={{ marginRight: 8 }}>
                <Icon name="highlight" size={24} color={colors.Text03} />
            </View>
            <Text style={localStyles.text}>{translate('Highlight')}</Text>
            <View style={{ marginLeft: 'auto' }}>
                <HighlightButton
                    projectId={projectId}
                    object={chat}
                    objectType={FEED_CHAT_OBJECT_TYPE}
                    disabled={disabled}
                />
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        maxHeight: 56,
        minHeight: 56,
        height: 56,
        paddingLeft: 8,
        paddingVertical: 8,
        alignItems: 'center',
    },
    text: {
        ...styles.subtitle2,
        color: colors.Text03,
    },
})
