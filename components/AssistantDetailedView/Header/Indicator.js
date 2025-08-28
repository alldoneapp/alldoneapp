import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSelector } from 'react-redux'

import Icon from '../../Icon'
import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'

export default function Indicator() {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    return (
        <View style={localStyles.container}>
            {!smallScreenNavigation && <Text style={localStyles.text}>{translate('Assistant')}</Text>}
            <Icon name="cpu" size={24} color={colors.Text03} style={localStyles.icon} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: 'white',
        flexDirection: 'row',
        justifyContent: 'center',
        paddingTop: 4,
    },
    text: {
        ...styles.subtitle1,
        color: colors.Text03,
        paddingTop: 2,
    },
    icon: {
        marginLeft: 12,
    },
})
