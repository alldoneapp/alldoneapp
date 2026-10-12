import React, { useContext } from 'react'
import { StyleSheet, TouchableOpacity } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import AssistantChatToggleIcon from '../UIComponents/AssistantChatToggleIcon'

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
            style={localStyles.container}
            onPress={toggleChat}
        >
            <span style={localStyles.icon} title={status} aria-hidden="true">
                <AssistantChatToggleIcon expanded={active} color={statusColor} />
            </span>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: 32,
        height: 32,
        flexShrink: 0,
        alignItems: 'center',
        justifyContent: 'center',
    },
    icon: {
        display: 'flex',
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
    },
})
