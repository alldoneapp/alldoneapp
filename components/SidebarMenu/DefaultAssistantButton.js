import React from 'react'
import { StyleSheet, Text, TouchableOpacity } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import AssistantAvatar from '../AdminPanel/Assistants/AssistantAvatar'
import styles from '../styles/global'
import { getTheme } from '../../Themes/Themes'
import { Themes } from './Themes'
import useCollapsibleSidebar from './Collapsible/UseCollapsibleSidebar'
import useOnHover from '../../hooks/UseOnHover'
import { hideWebSideBar } from '../../redux/actions'
import { setAnnaMode, useAnnaMode } from '../../utils/annaMode'
import { translate } from '../../i18n/TranslationService'

export default function DefaultAssistantButton() {
    const dispatch = useDispatch()
    const assistant = useSelector(state => state.defaultAssistant)
    const themeName = useSelector(state => state.loggedUser.themeName)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const { expanded } = useCollapsibleSidebar()
    const active = useAnnaMode()
    const { hover, onHover, offHover } = useOnHover(active, active)
    const theme = getTheme(Themes, themeName, 'CustomSideMenu.AllProjects')

    if (!assistant?.uid) return null

    const name = assistant.displayName?.trim() || translate('Assistant')
    const photo = assistant.photoURL50 || assistant.photoURL300 || assistant.photoURL
    const openChat = () => {
        if (smallScreenNavigation) dispatch(hideWebSideBar())
        setAnnaMode(true)
    }

    return (
        <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={name}
            title={name}
            style={[
                localStyles.container,
                theme.containerInactive,
                (active || hover) && theme.containerActive,
                !expanded && localStyles.containerCollapsed,
            ]}
            onPress={openChat}
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
                <Text numberOfLines={1} style={[localStyles.name, active ? theme.title : theme.titleInactive]}>
                    {name}
                </Text>
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
})
