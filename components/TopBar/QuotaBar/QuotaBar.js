import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import styles from '../../styles/global'
import { navigateToSettings } from '../../../redux/actions'
import { DV_TAB_SETTINGS_PREMIUM } from '../../../utils/TabNavigationConstants'
import NavigationService from '../../../utils/NavigationService'
import { getTheme } from '../../../Themes/Themes'
import { Themes } from '../Themes'
import Icon from '../../Icon'
import { translate } from '../../../i18n/TranslationService'
import Percent from './Percent'

export const QUOTA_BAR_MOBILE = 0
export const QUOTA_BAR_NORMAL = 1

export default function QuotaBar({ size = QUOTA_BAR_NORMAL }) {
    const dispatch = useDispatch()
    const themeName = useSelector(state => state.loggedUser.themeName)
    const smallScreen = useSelector(state => state.smallScreen)

    const theme = getTheme(Themes, themeName, 'TopBar.TopBarStatisticArea.QuotaBar')

    const onPress = () => {
        dispatch(navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_PREMIUM }))
        NavigationService.navigate('SettingsView')
    }

    return (
        <TouchableOpacity
            style={[
                (size === QUOTA_BAR_MOBILE ? mobileStyles : localStyles).container,
                smallScreen || size === QUOTA_BAR_MOBILE ? { marginRight: 8, paddingHorizontal: 8 } : null,
                size === QUOTA_BAR_MOBILE ? theme.containerMobile : theme.container,
            ]}
            onPress={onPress}
        >
            {smallScreen || size === QUOTA_BAR_MOBILE ? (
                <Icon
                    name="cap"
                    size={20}
                    color={size === QUOTA_BAR_MOBILE ? theme.iconColorMobile : theme.iconColor}
                />
            ) : (
                <Text
                    style={[
                        (size === QUOTA_BAR_MOBILE ? mobileStyles : localStyles).text,
                        size === QUOTA_BAR_MOBILE ? theme.textMobile : theme.text,
                    ]}
                >
                    {translate('Free quota')}
                </Text>
            )}
            <Percent />
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
