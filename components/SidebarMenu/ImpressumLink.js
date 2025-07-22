import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useSelector } from 'react-redux'

import styles from '../styles/global'
import { getTheme } from '../../Themes/Themes'
import { Themes } from './Themes'
import { translate } from '../../i18n/TranslationService'

export default function ImpressumLink() {
    const themeName = useSelector(state => state.loggedUser.themeName)

    const theme = getTheme(Themes, themeName, 'CustomSideMenu.ImpressumLink')

    const goToImprint = () => {
        window.open(`https://alldone.app/impressum`, '_blank')
    }

    const goToPrivacy = () => {
        window.open(`https://alldone.app/privacy`, '_blank')
    }

    const goToTerms = () => {
        window.open(`https://alldone.app/terms`, '_blank')
    }

    return (
        <View style={localStyles.container}>
            <TouchableOpacity onPress={goToImprint}>
                <View style={localStyles.link}>
                    <Text style={[localStyles.text, theme.text]} numberOfLines={1}>
                        {translate('Impressum')}
                    </Text>
                </View>
            </TouchableOpacity>
            <View style={[localStyles.separator, theme.separator]} />
            <TouchableOpacity onPress={goToPrivacy}>
                <View style={localStyles.link}>
                    <Text style={[localStyles.text, theme.text]} numberOfLines={1}>
                        {translate('Privacy')}
                    </Text>
                </View>
            </TouchableOpacity>
            <View style={[localStyles.separator, theme.separator]} />
            <TouchableOpacity onPress={goToTerms}>
                <View style={localStyles.link}>
                    <Text style={[localStyles.text, theme.text]} numberOfLines={1}>
                        {translate('Terms')}
                    </Text>
                </View>
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        width: '100%',
        paddingHorizontal: 24,
        alignItems: 'center',
        maxHeight: 30,
        flexWrap: 'nowrap',
        overflow: 'hidden',
    },
    link: {
        height: 48,
        alignItems: 'center',
        flexDirection: 'row',
    },
    text: {
        ...styles.body2,
        color: '#FFFFFF',
        opacity: 0.4,
        flexWrap: 'nowrap',
    },
    separator: {
        marginHorizontal: 8,
        width: 4,
        height: 4,
        borderRadius: 50,
        backgroundColor: '#ffffff',
        opacity: 0.4,
    },
})
