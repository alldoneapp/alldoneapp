import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

export default function InvitationsHeader({ amount = 0 }) {
    const parseText = number => {
        if (number == null || number <= 0) {
            return translate('No invitations yet')
        } else if (number > 1) {
            return number + ` ${translate('invitations')}`
        }
        return number + ` ${translate('invitation')}`
    }

    return (
        <View style={localStyles.container}>
            <View style={localStyles.headerInfo}>
                <Text style={[styles.title6, { color: colors.Text01 }]}>{translate('Invitations')}</Text>
                <View style={localStyles.headerCaption}>
                    <Text style={[styles.caption2, { color: colors.Text02 }]}>{parseText(amount)}</Text>
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        height: 72,
        maxHeight: 72,
        paddingTop: 32,
        paddingBottom: 12,
        alignItems: 'center',
        justifyContent: 'space-between',
        flexDirection: 'row',
    },
    headerInfo: {
        flexDirection: 'row',
        alignItems: 'baseline',
    },
    headerCaption: {
        marginLeft: 16,
        height: 22,
        justifyContent: 'center',
    },
})
