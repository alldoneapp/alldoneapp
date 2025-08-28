import React from 'react'
import { StyleSheet, Text, TouchableOpacity, Animated } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import Icon from '../../../Icon'
import { translate } from '../../../../i18n/TranslationService'
import { getTheme } from '../../../../Themes/Themes'
import { Themes } from '../../Themes'
import useCollapsibleSidebar from '../../Collapsible/UseCollapsibleSidebar'
import { em2px } from '../../../styles/global'
import store from '../../../../redux/store'
import Backend from '../../../../utils/BackendBridge'
import { storeLoggedUser } from '../../../../redux/actions'
import { setUserSidebarExpanded } from '../../../../utils/backends/Users/usersFirestore'

export default function CollapseButton({ targetWidth }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const themeName = useSelector(state => state.loggedUser.themeName)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const { expanded, overlay } = useCollapsibleSidebar()

    const theme = getTheme(Themes, themeName, 'CustomSideMenu.CollapseButton')
    const isFloating = smallScreenNavigation || (overlay && expanded)

    const parentStyles = [
        localStyles.parent,
        overlay && localStyles.overlayParent,
        isFloating && localStyles.parentFloating,
        theme.parent,
        { width: targetWidth },
    ]

    const toggleSidebarUser = () => {
        const { loggedUser } = store.getState()
        const { sidebarExpanded, uid } = loggedUser
        dispatch(storeLoggedUser({ ...loggedUser, sidebarExpanded: !sidebarExpanded }))
        setUserSidebarExpanded(uid, !sidebarExpanded)
    }

    return (
        <Animated.View style={parentStyles}>
            {!isAnonymous && (
                <TouchableOpacity
                    accessible={false}
                    onPress={toggleSidebarUser}
                    style={[localStyles.container, localStyles.containerCollapsed, theme.container]}
                >
                    <Icon size={22} name={expanded ? 'chevrons-left' : 'chevrons-right'} color={theme.iconColor} />
                    {expanded && (
                        <Text style={[localStyles.text, theme.text]} numberOfLines={1}>
                            {translate('Collapse sidebar')}
                        </Text>
                    )}
                </TouchableOpacity>
            )}
        </Animated.View>
    )
}

const localStyles = StyleSheet.create({
    parent: {
        position: 'absolute',
        bottom: 0,
        height: 56,
        flexDirection: 'row',
    },
    parentFloating: {
        shadowColor: 'rgba(0,0,0,0.56)',
        shadowOffset: { width: 0, height: -16 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    overlayParent: {
        left: 0,
    },
    container: {
        width: '100%',
        height: 56,
        flexDirection: 'row',
        paddingVertical: 16,
        paddingHorizontal: 24,
        overflow: 'hidden',
        opacity: 0.64,
    },
    containerCollapsed: {
        paddingLeft: 17,
    },
    text: {
        fontFamily: 'Roboto-Regular',
        fontSize: 16,
        lineHeight: 24,
        letterSpacing: em2px(0.02),
        marginLeft: 10,
        flexWrap: 'nowrap',
    },
})
