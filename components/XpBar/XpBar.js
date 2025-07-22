import React, { useState, useEffect } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { navigateToSettings } from '../../redux/actions'
import { getXpNeededToReachLevel, getRelativeLevelXp } from '../../utils/Levels'
import styles from '../styles/global'
import NavigationService from '../../utils/NavigationService'
import { DV_TAB_SETTINGS_PROFILE } from '../../utils/TabNavigationConstants'
import { getTheme } from '../../Themes/Themes'
import { Themes } from '../TopBar/Themes'
import { setUserShowSkillPointsNotification } from '../../utils/backends/Users/usersFirestore'
import Avatar from '../Avatar'

export const XP_BAR_DESKTOP = 'DESKTOP'
export const XP_BAR_TABLET = 'TABLET'
export const XP_BAR_MOBILE = 'MOBILE'

export const barWidth = {
    [XP_BAR_DESKTOP]: 196,
    [XP_BAR_TABLET]: 137,
    [XP_BAR_MOBILE]: 92,
}
export const barProgWidth = {
    [XP_BAR_DESKTOP]: 174,
    [XP_BAR_TABLET]: 122,
    [XP_BAR_MOBILE]: 70,
}

export default function XpBar({ size = XP_BAR_DESKTOP }) {
    const dispatch = useDispatch()
    const topBarWidth = useSelector(state => state.topBarWidth)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const smallScreen = useSelector(state => state.smallScreen)
    const themeName = useSelector(state => state.loggedUser.themeName)
    const xp = useSelector(state => state.loggedUser.xp)
    const level = useSelector(state => state.loggedUser.level)
    const skillPoints = useSelector(state => state.loggedUser.skillPoints)
    const photoURL = useSelector(state => state.loggedUser.photoURL)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const showSkillPointsNotification = useSelector(state => state.loggedUser.showSkillPointsNotification)
    const [offSet, setOffset] = useState(0)

    const theme = getTheme(Themes, themeName, 'TopBar.TopBarStatisticArea.XpBar')

    const barWidthOffSet = {
        [XP_BAR_DESKTOP]: barWidth[XP_BAR_DESKTOP] - offSet,
        [XP_BAR_TABLET]: barWidth[XP_BAR_TABLET] - offSet,
        [XP_BAR_MOBILE]: barWidth[XP_BAR_MOBILE],
    }

    const barProgWidthOffSet = {
        [XP_BAR_DESKTOP]: barProgWidth[XP_BAR_DESKTOP] - offSet,
        [XP_BAR_TABLET]: barProgWidth[XP_BAR_TABLET] - offSet,
        [XP_BAR_MOBILE]: barProgWidth[XP_BAR_MOBILE],
    }

    const xpPercent = getRelativeLevelXp(level, xp) / getXpNeededToReachLevel(level + 1)
    const barPosition = xpPercent * (barProgWidthOffSet[size] - 26)

    const bgColor = size === XP_BAR_MOBILE ? theme.bgColorMobile : theme.bgColorDesktop

    const navigateToUserProfile = () => {
        dispatch(navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_PROFILE }))
        NavigationService.navigate('SettingsView')
        setUserShowSkillPointsNotification(loggedUserId, false)
    }

    const appendSizeLimits = () => {
        return size === XP_BAR_DESKTOP || size === XP_BAR_TABLET
            ? {
                  minWidth: barWidthOffSet[XP_BAR_TABLET],
                  maxWidth: barWidthOffSet[XP_BAR_DESKTOP],
              }
            : undefined
    }

    useEffect(() => {
        if (smallScreenNavigation) {
            setOffset(0)
        } else {
            const baseWidth = isMiddleScreen ? 676 : smallScreen ? 761 : 815
            let offSet = topBarWidth < baseWidth ? baseWidth - topBarWidth : 0
            if (offSet > 136) offSet = 136
            setOffset(offSet)
        }
    }, [topBarWidth])

    const showSkillPoints = skillPoints > 0 && showSkillPointsNotification

    return (
        <View nativeID="xpArea" style={[localStyles.parent, { marginRight: size === XP_BAR_DESKTOP ? 16 : 8 }]}>
            <TouchableOpacity
                style={[
                    localStyles.container,
                    theme.container,
                    { width: barWidthOffSet[size], backgroundColor: bgColor },
                    appendSizeLimits(),
                ]}
                onPress={navigateToUserProfile}
            >
                <View style={[localStyles.bar, theme.bar, { width: barProgWidthOffSet[size] }]}>
                    <View style={[localStyles.filledBar, theme.filledBar, { width: barPosition + 13 }]} />
                </View>
                <View
                    style={[
                        localStyles.levelContainer,
                        showSkillPoints ? theme.skillContainer : theme.levelContainer,
                        { left: 16 + barPosition },
                    ]}
                >
                    <View style={localStyles.avatarContainer}>
                        <Avatar avatarId={loggedUserId} reviewerPhotoURL={photoURL} size={16} borderSize={0} />
                    </View>
                    <Text style={[localStyles.level, showSkillPoints ? theme.skillPoints : theme.level]}>
                        {showSkillPoints ? skillPoints : level}
                    </Text>
                </View>
            </TouchableOpacity>
        </View>
    )
}

const localStyles = StyleSheet.create({
    parent: {
        flex: 1,
        alignItems: 'flex-end',
        marginRight: 16,
    },
    container: {
        flexDirection: 'row',
        alignItems: 'center',
        height: 28,
        borderRadius: 50,
    },
    bar: {
        height: 8,
        marginLeft: 10,
        borderRadius: 4,
    },
    filledBar: {
        height: 8,
        borderRadius: 4,
    },
    levelContainer: {
        position: 'absolute',
        top: 5,
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 18,
        height: 18,
        borderRadius: 40,
        borderWidth: 2,
        paddingHorizontal: 4,
        flexDirection: 'row',
    },
    avatarContainer: {
        marginRight: 4,
    },
    level: {
        ...styles.body3,
        lineHeight: 11,
    },
})
