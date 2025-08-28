import React from 'react'
import { View, Text } from 'react-native'

import styles, { colors } from '../../../styles/global'
import Emoji from '../../../../assets/svg/Emoji'
import { translate } from '../../../../i18n/TranslationService'

export default function SuccessfullyPayment() {
    return (
        <View style={{ marginTop: 34 }}>
            <Text style={[styles.subtitle1, { color: colors.Text01, marginBottom: 16 }]}>
                {translate('Your payment was made successfully')}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 32 }}>
                <Emoji style={{ marginRight: 16 }} />
                <Text style={[styles.title4, { color: colors.Text01 }]}>
                    {translate('Thanks for your Premium subscription')}
                </Text>
            </View>
        </View>
    )
}
