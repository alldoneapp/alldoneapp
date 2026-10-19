import React, { useContext, useState } from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import AssistantModeIcon from '../UIComponents/AssistantModeIcon'

import { colors } from '../styles/global'
import { getTheme } from '../../Themes/Themes'
import { Themes } from './Themes'
import {
    hideFloatPopup,
    hideGlobalSearchPopup,
    hideWebSideBar,
    navigateToAllProjectsTasks,
    setGlobalSearchResults,
} from '../../redux/actions'
import { setAnnaMode, useAnnaMode } from '../../utils/annaMode'
import NavigationService from '../../utils/NavigationService'
import AnnaChatNavigationContext from '../Anna/AnnaChatNavigationContext'
import { translate } from '../../i18n/TranslationService'

export default function DefaultAssistantButton() {
    const dispatch = useDispatch()
    const assistant = useSelector(state => state.defaultAssistant)
    const themeName = useSelector(state => state.loggedUser.themeName)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const active = useAnnaMode()
    const showChat = useContext(AnnaChatNavigationContext)
    const [hovered, setHovered] = useState(false)
    const theme = getTheme(Themes, themeName, 'CustomSideMenu.AllProjects')

    if (!assistant?.uid) return null

    const name = assistant.displayName?.trim() || translate('Assistant')
    const status = translate(active ? 'Close assistant chat' : 'Open assistant chat')
    const statusColor = theme.titleInactive?.color || colors.Text03
    const toggleChat = () => {
        if (smallScreenNavigation) dispatch(hideWebSideBar())
        if (active) setAnnaMode(false)
        else showChat()
        dispatch([
            hideFloatPopup(),
            hideGlobalSearchPopup(),
            setGlobalSearchResults(null),
            navigateToAllProjectsTasks({ taskViewToggleSection: 'Open', taskViewToggleIndex: 0 }),
        ])
        NavigationService.navigate('Root')
    }

    return (
        <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={`${name}: ${status}`}
            aria-expanded={active}
            style={[localStyles.container, hovered && localStyles.hovered]}
            hitSlop={{ top: 6, bottom: 6, left: 0, right: 0 }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onPress={toggleChat}
        >
            <AssistantModeIcon
                assistant={assistant}
                expanded={active}
                color={active || hovered ? colors.Primary100 : statusColor}
                hovered={hovered}
                title={`${name}: ${status}`}
            />
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: 46,
        height: 32,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
    },
    hovered: {
        backgroundColor: '#E2EFFF',
    },
})
