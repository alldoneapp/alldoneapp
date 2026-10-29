import React, { useState } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import Icon from '../Icon'
import navigateToHome from '../../utils/navigateToHome'
import store from '../../redux/store'
import AmountTag from '../Feeds/FollowSwitchableTag/AmountTag'
import getAllProjectsOpenTasksAmount from '../../utils/Tasks/getAllProjectsOpenTasksAmount'
import { colors } from '../styles/global'
import { translate } from '../../i18n/TranslationService'

export const HOME_BUTTON_WIDTH = 40

export default function HomeButton({ color, style, expandSecondaryBar }) {
    const [hovered, setHovered] = useState(false)
    const dispatch = useDispatch()
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)
    const sidebarNumbers = useSelector(state => state.sidebarNumbers)

    const openTasksAmount = getAllProjectsOpenTasksAmount(
        sidebarNumbers,
        loggedUserId,
        archivedProjectIds,
        templateProjectIds
    )

    const onPress = e => {
        e?.preventDefault()
        if (store.getState().expandedNavPicker) expandSecondaryBar?.()

        navigateToHome(dispatch)
    }

    return (
        <TouchableOpacity
            style={[localStyles.button, hovered && localStyles.hovered, style]}
            onPress={onPress}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            accessibilityRole="button"
            accessibilityLabel={translate('Go to home')}
        >
            <Icon size={24} name={'home'} color={color} />
            {openTasksAmount > 0 && (
                <View style={localStyles.badge} testID="home-open-tasks-badge">
                    <AmountTag
                        feedAmount={openTasksAmount}
                        isFollowedButton={false}
                        showFullAmount={true}
                        style={localStyles.badgeTag}
                    />
                </View>
            )}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    button: {
        alignItems: 'center',
        justifyContent: 'center',
        height: 28,
        width: HOME_BUTTON_WIDTH,
        borderRadius: 50,
        backgroundColor: colors.UtilityBlue112,
    },
    hovered: {
        backgroundColor: colors.UtilityBlue125,
    },
    badge: {
        position: 'absolute',
        top: 0,
        left: HOME_BUTTON_WIDTH / 2,
    },
    badgeTag: {
        backgroundColor: colors.Primary100,
    },
})
