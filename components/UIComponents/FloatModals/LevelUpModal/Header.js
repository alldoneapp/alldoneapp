import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import { translate } from '../../../../i18n/TranslationService'

export default function Header() {
    return (
        <View>
            <Text style={localStyles.header}>{translate('Congrats you have leveled up')}</Text>
            <Text style={localStyles.description}>
                {translate('Just like in real life you gain experience points when you do things on Alldone')}
            </Text>
        </View>
    )
}

const localStyles = StyleSheet.create({
    header: {
        ...styles.title7,
        color: 'white',
    },
    description: {
        ...styles.body2,
        color: colors.Text03,
    },
})
