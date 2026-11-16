import React, { useCallback } from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { navigateToSettings } from '../../../redux/actions'
import { DV_TAB_SETTINGS_PREMIUM } from '../../../utils/TabNavigationConstants'
import NavigationService from '../../../utils/NavigationService'
import Icon from '../../Icon'
import { getTheme } from '../../../Themes/Themes'
import { Themes } from '../Themes'
import { translate } from '../../../i18n/TranslationService'

export const QUOTA_BAR_MOBILE = 0
export const QUOTA_BAR_NORMAL = 1

// Width of the crown-only badge on desktop: the 20px crown plus 6px on each side, so the hit target
// stays a full 32x28 pill while the header saves the old "Premium" label's room.
export const PREMIUM_BAR_DESKTOP_WIDTH = 32

// The paid user's badge: the crown alone, everywhere (2026-11-16: "the user already paid - no need to
// annoy him"). The name stays available as the accessible label and as the hover tooltip; a click
// still opens Settings > Premium. Non-premium users see QuotaBar instead, unchanged.
// `compact`: only the gap to the next item now (AnnaTopStrip passes it from its own room); left out,
// the small-screen flag decides.
export default function PremiumBar({ size = QUOTA_BAR_NORMAL, compact }) {
    const dispatch = useDispatch()
    const smallScreenFlag = useSelector(state => state.smallScreen)
    const smallScreen = compact ?? smallScreenFlag
    const themeName = useSelector(state => state.loggedUser.themeName)

    const theme = getTheme(Themes, themeName, 'TopBar.TopBarStatisticArea.PremiumBar')
    const mobile = size === QUOTA_BAR_MOBILE
    const label = translate('Premium')

    // react-native-web does not forward `title`, so the tooltip is set on the DOM node directly.
    const setTooltip = useCallback(node => node?.setAttribute?.('title', label), [label])

    const onPress = () => {
        dispatch(navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_PREMIUM }))
        NavigationService.navigate('SettingsView')
    }

    return (
        <TouchableOpacity
            ref={setTooltip}
            testID="premium-bar"
            accessibilityRole="button"
            accessibilityLabel={label}
            style={[
                mobile ? mobileStyles.container : localStyles.container,
                !mobile && smallScreen ? localStyles.smallScreen : null,
                theme[mobile ? 'mobile' : 'desktop'].container,
            ]}
            onPress={onPress}
        >
            <Icon name={'crown'} size={20} color={mobile ? theme.iconColorMobile : theme.iconColor} />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 50,
        height: 28,
        width: PREMIUM_BAR_DESKTOP_WIDTH,
        flexShrink: 0,
        marginRight: 16,
    },
    smallScreen: {
        marginRight: 8,
    },
})

const mobileStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 50,
        height: 28,
        paddingHorizontal: 8,
        marginRight: 8,
    },
})
