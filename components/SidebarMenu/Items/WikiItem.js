import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import styles from '../../styles/global'
import Icon from '../../Icon'
import store from '../../../redux/store'
import { hideWebSideBar } from '../../../redux/actions'
import { DV_TAB_ROOT_WIKI } from '../../../utils/TabNavigationConstants'
import { translate } from '../../../i18n/TranslationService'
import { getUserItemTheme } from '../Themes'
import useCollapsibleSidebar from '../Collapsible/UseCollapsibleSidebar'
import useOnHover from '../../../hooks/UseOnHover'
import { openProjectWiki } from '../../WikiView/wikiLinks'

// The project wiki in the simple sidebar, where the project only lists its people. It is drawn
// like those rows rather than reusing the section header the full sidebar uses for "Wiki",
// because that one sits on the section background and would read as a separate block here.
export default function WikiItem({ projectId, projectColor }) {
    const dispatch = useDispatch()
    const themeName = useSelector(state => state.loggedUser.themeName)
    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)
    const route = useSelector(state => state.route)
    const { expanded } = useCollapsibleSidebar()

    const theme = getUserItemTheme(themeName)
    const highlight = selectedSidebarTab === DV_TAB_ROOT_WIKI && route !== 'ProjectDetailedView'
    const { hover, onHover, offHover } = useOnHover(highlight, highlight)

    const onPress = e => {
        e?.preventDefault()
        openProjectWiki(projectId)
        if (store.getState().smallScreenNavigation) dispatch(hideWebSideBar())
    }

    return (
        <TouchableOpacity
            onPress={onPress}
            accessibilityLabel={'sidebar-wiki-item'}
            nativeID={`sidebar-wiki@${projectId}`}
        >
            <View
                style={[
                    localStyles.container,
                    highlight ? theme.containerActive(projectColor) : theme.container(projectColor),
                    !expanded && localStyles.containerCollapsed,
                    !highlight && hover && theme.containerActive(projectColor),
                ]}
                onMouseEnter={onHover}
                onMouseLeave={offHover}
            >
                <Icon
                    size={20}
                    name={'book-open'}
                    color={highlight ? theme.nameActive.color : theme.name.color}
                    style={localStyles.icon}
                />
                {expanded && (
                    <Text style={[localStyles.text, highlight ? theme.nameActive : theme.name]} numberOfLines={1}>
                        {translate('Wiki')}
                    </Text>
                )}
            </View>
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        alignItems: 'center',
        flexDirection: 'row',
        height: 48,
        paddingLeft: 26,
    },
    containerCollapsed: {
        paddingLeft: 18,
    },
    icon: {
        height: 20,
        width: 20,
        marginRight: 10,
    },
    text: {
        ...styles.body2,
        lineHeight: 20,
    },
})
