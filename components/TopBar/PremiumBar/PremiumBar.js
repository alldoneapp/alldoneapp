import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import styles from '../../styles/global'
import { navigateToSettings } from '../../../redux/actions'
import { DV_TAB_SETTINGS_PREMIUM } from '../../../utils/TabNavigationConstants'
import NavigationService from '../../../utils/NavigationService'
import Icon from '../../Icon'
import { getTheme } from '../../../Themes/Themes'
import { Themes } from '../Themes'
import { translate } from '../../../i18n/TranslationService'

export const QUOTA_BAR_MOBILE = 0
export const QUOTA_BAR_NORMAL = 1

export default function PremiumBar({ size = QUOTA_BAR_NORMAL }) {
    const dispatch = useDispatch()
    const smallScreen = useSelector(state => state.smallScreen)
    const themeName = useSelector(state => state.loggedUser.themeName)

    const theme = getTheme(Themes, themeName, 'TopBar.TopBarStatisticArea.PremiumBar')

    const onPress = () => {
        dispatch(navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_PREMIUM }))
        NavigationService.navigate('SettingsView')
    }

    return (
        <TouchableOpacity
            style={[
                (size === QUOTA_BAR_MOBILE ? mobileStyles : localStyles).container,
                smallScreen || size === QUOTA_BAR_MOBILE ? { marginRight: 8, paddingHorizontal: 8 } : null,
                theme[size === QUOTA_BAR_MOBILE ? 'mobile' : 'desktop'].container,
            ]}
            onPress={onPress}
        >
            <Icon
                name={'crown'}
                size={20}
                color={size === QUOTA_BAR_MOBILE ? theme.iconColorMobile : theme.iconColor}
            />
            {!smallScreen && size !== QUOTA_BAR_MOBILE && (
                <Text
                    style={[
                        (size === QUOTA_BAR_MOBILE ? mobileStyles : localStyles).text,
                        theme[size === QUOTA_BAR_MOBILE ? 'mobile' : 'desktop'].text,
                    ]}
                >
                    {translate('Premium')}
                </Text>
            )}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 50,
        height: 28,
        paddingHorizontal: 12,
        marginRight: 16,
    },
    text: {
        ...styles.caption2,
        marginLeft: 6,
    },
})

const mobileStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 50,
        height: 28,
        paddingHorizontal: 12,
        marginRight: 16,
    },
    text: {
        ...styles.caption2,
    },
})
