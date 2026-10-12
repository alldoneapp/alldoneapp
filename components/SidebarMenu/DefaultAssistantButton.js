import React, { useContext } from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import Svg, { Path, Rect } from 'react-native-svg'

import AssistantAvatar from '../AdminPanel/Assistants/AssistantAvatar'
import styles, { colors } from '../styles/global'
import { COLORS_THEME_DEFAULT, getTheme } from '../../Themes/Themes'
import { Themes } from './Themes'
import useCollapsibleSidebar from './Collapsible/UseCollapsibleSidebar'
import useOnHover from '../../hooks/UseOnHover'
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
    const { expanded } = useCollapsibleSidebar()
    const active = useAnnaMode()
    const showChat = useContext(AnnaChatNavigationContext)
    const { hover, onHover, offHover } = useOnHover(active, active)
    const theme = getTheme(Themes, themeName, 'CustomSideMenu.AllProjects')

    if (!assistant?.uid) return null

    const name = assistant.displayName?.trim() || translate('Assistant')
    const status = translate(active ? 'Assistant chat open' : 'Open assistant chat')
    const statusColor = active
        ? themeName === COLORS_THEME_DEFAULT
            ? colors.UtilityBlue
            : colors.Primary100
        : colors.Text03
    const photo = assistant.photoURL50 || assistant.photoURL300 || assistant.photoURL
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
            accessibilityLabel={name}
            aria-expanded={active}
            style={[
                localStyles.container,
                theme.containerInactive,
                (active || hover) && theme.containerActive,
                !expanded && localStyles.containerCollapsed,
            ]}
            onPress={toggleChat}
            onMouseEnter={onHover}
            onMouseLeave={offHover}
        >
            <AssistantAvatar
                assistantId={assistant.uid}
                photoURL={photo?.uri || photo}
                size={22}
                containerStyle={{ flexShrink: 0, marginRight: expanded ? 10 : 0 }}
            />
            {expanded && (
                <>
                    <Text numberOfLines={1} style={[localStyles.name, active ? theme.title : theme.titleInactive]}>
                        {name}
                    </Text>
                    <span style={localStyles.status} title={status} aria-hidden="true">
                        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
                            {active && <Rect x={3} y={3} width={6} height={18} fill={statusColor} fillOpacity={0.25} />}
                            <Rect x={3} y={3} width={18} height={18} rx={2} stroke={statusColor} strokeWidth={2} />
                            <Path
                                d={active ? 'M9 3v18' : 'm8 8 4 4-4 4'}
                                stroke={statusColor}
                                strokeWidth={2}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                            />
                        </Svg>
                    </span>
                </>
            )}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginTop: 32,
        height: 56,
        flexShrink: 0,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 24,
    },
    containerCollapsed: {
        paddingHorizontal: 17,
    },
    name: {
        ...styles.body1,
        flex: 1,
        minWidth: 0,
    },
    status: {
        display: 'flex',
        flexShrink: 0,
        marginLeft: 8,
    },
})
