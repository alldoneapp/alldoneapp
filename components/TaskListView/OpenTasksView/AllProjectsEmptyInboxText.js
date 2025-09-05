import React from 'react'
import { Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

export default function AllProjectsEmptyInboxText() {
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)

    return (
        <View style={[localStyles.emptyInboxText, isMiddleScreen ? localStyles.emptyInboxTextMobile : undefined]}>
            <Text style={[styles.body1, { color: colors.Text02, textAlign: 'center' }]}>
                {translate('Congrats - you have reached empty inbox across all your projects')}
            </Text>
        </View>
    )
}

const localStyles = {
    emptyInboxText: {
        maxWidth: 700,
        alignItems: 'flex-start',
        flexDirection: 'row',
        marginBottom: 16,
    },
    emptyInboxTextMobile: {
        marginHorizontal: 16,
    },
}
