import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import { useSelector } from 'react-redux'
import { translate } from '../../i18n/TranslationService'

const MemberTag = ({ style, onPress, isMobile = false, iconSize = 16, textStyle, text, icon }) => {
    const mobile = useSelector(state => state.smallScreenNavigation)

    return (
        <TouchableOpacity onPress={onPress}>
            <View style={[localStyles.container, style]}>
                <Icon name={icon || 'users'} size={iconSize} color={colors.UtilityLime300} style={localStyles.icon} />
                {!mobile && (
                    <Text style={[localStyles.text, textStyle, windowTagStyle()]}>{translate(text || 'Project')}</Text>
                )}
            </View>
        </TouchableOpacity>
    )
}

export default MemberTag

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        backgroundColor: colors.UtilityLime112,
        borderRadius: 50,
        alignItems: 'center',
        justifyContent: 'center',
        height: 24,
    },
    icon: {
        marginHorizontal: 4,
    },
    text: {
        ...styles.subtitle2,
        color: colors.UtilityLime300,
        marginVertical: 1,
        marginRight: 10,
        marginLeft: 2,
    },
})
