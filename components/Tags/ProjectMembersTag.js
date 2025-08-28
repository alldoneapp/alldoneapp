import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import { useSelector } from 'react-redux'
import { translate } from '../../i18n/TranslationService'

const ProjectMembersTag = ({ amount, style, onPress, isMobile = false }) => {
    const mobile = useSelector(state => state.smallScreenNavigation)

    return amount > 0 ? (
        <TouchableOpacity onPress={onPress}>
            <View style={[localStyles.container, style]}>
                <Icon name={'users'} size={16} color={colors.Text03} style={localStyles.icon} />
                <Text style={[styles.subtitle2, localStyles.text, windowTagStyle()]}>{`${amount}${
                    mobile || isMobile ? '' : amount <= 1 ? ` ${translate('Member')}` : ` ${translate('Members')}`
                }`}</Text>
            </View>
        </TouchableOpacity>
    ) : null
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

export default ProjectMembersTag
