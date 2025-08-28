import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import { translate } from '../../i18n/TranslationService'
import { useSelector } from 'react-redux'

const PendingTag = ({ style, onPress }) => {
    const mobile = useSelector(state => state.smallScreenNavigation)

    return (
        <TouchableOpacity onPress={onPress}>
            <View style={[localStyles.container, style]}>
                <Icon name={'clock'} size={16} color={colors.Text03} style={localStyles.icon} />
                {!mobile && (
                    <Text style={[styles.subtitle2, localStyles.text, windowTagStyle()]}>{translate('Pending')}</Text>
                )}
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.Gray300,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
    },
    icon: {
        marginHorizontal: 4,
    },
    text: {
        color: colors.Text03,
        marginVertical: 1,
        marginRight: 10,
        marginLeft: 2,
    },
})

export default PendingTag
