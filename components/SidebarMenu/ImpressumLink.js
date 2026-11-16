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

    const links = [
        [translate('Impressum'), goToImprint],
        [translate('Privacy'), goToPrivacy],
        [translate('Terms'), goToTerms],
    ]

    // The links wrap onto a second line where the sidebar is too narrow for them; gaps instead of
    // dots, which would dangle at a line's end. Before, one clipped line cut the last link off. The
    // cookie settings live in Settings > Customizations (AnalyticsConsent).
    return (
        <View style={localStyles.container}>
            {links.map(([label, onPress]) => (
                <TouchableOpacity key={label} onPress={onPress} style={localStyles.link}>
                    <Text style={[localStyles.text, theme.text]} numberOfLines={1}>
                        {label}
                    </Text>
                </TouchableOpacity>
            ))}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        width: '100%',
        paddingHorizontal: 24,
        paddingBottom: 16,
        alignItems: 'center',
        columnGap: 16,
    },
    link: {
        paddingVertical: 4,
    },
    text: {
        ...styles.body2,
        color: '#FFFFFF',
        opacity: 0.4,
    },
})
