import React, { useEffect } from 'react'
import { Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import {
    hideFloatPopup,
    hideGlobalSearchPopup,
    navigateToAllProjectsTasks,
    setGlobalSearchResults,
    updateFeedActiveTab,
} from '../../../redux/actions'
import styles, { em2px } from '../../styles/global'
import { PROJECT_TYPE_ACTIVE, PROJECT_TYPE_GUIDE } from '../../SettingsView/ProjectsSettings/ProjectsSettings'
import { checkIfSelectedAllProjects, checkIfSelectedProject } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import NavigationService from '../../../utils/NavigationService'
import { FOLLOWED_TAB } from '../../Feeds/Utils/FeedsConstants'
import { ROOT_ROUTES } from '../../../utils/TabNavigationConstants'
import { exitsOpenModals } from '../../ModalsManager/modalsManager'
import { getTheme } from '../../../Themes/Themes'
import { Themes } from '../Themes'
import { translate } from '../../../i18n/TranslationService'
import useCollapsibleSidebar from '../Collapsible/UseCollapsibleSidebar'
import useOnHover from '../../../hooks/UseOnHover'
import AmountBadgeContainer from './AmountBadgeContainer'
import ItemShortcut from '../Items/Common/ItemShortcut'

export default function AllProjectsButton() {
    const dispatch = useDispatch()
    const showShortcuts = useSelector(state => state.showShortcuts)
    const showFloatPopup = useSelector(state => state.showFloatPopup)
    const themeName = useSelector(state => state.loggedUser.themeName)
    const loggedUserPhotoURL = useSelector(state => state.loggedUser.photoURL)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const selectedTypeOfProject = useSelector(state => state.selectedTypeOfProject)
    const shortcutSelectedProjectIndex = useSelector(state => state.shortcutSelectedProjectIndex)
    const route = useSelector(state => state.route)

    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)

    const { expanded } = useCollapsibleSidebar()

    const highlight =
        checkIfSelectedAllProjects(selectedProjectIndex) &&
        (selectedTypeOfProject === PROJECT_TYPE_ACTIVE || selectedTypeOfProject === PROJECT_TYPE_GUIDE)

    const showShortcut = showShortcuts && showFloatPopup === 0 && !exitsOpenModals()
    const { hover, onHover, offHover } = useOnHover(highlight, highlight)

    const theme = getTheme(Themes, themeName, 'CustomSideMenu.AllProjects')

    useEffect(() => {
        if (checkIfSelectedAllProjects(shortcutSelectedProjectIndex)) onPress()
    }, [shortcutSelectedProjectIndex])

    const onPress = e => {
        e?.preventDefault()

        if (!ROOT_ROUTES.includes(route)) NavigationService.navigate('Root')

        dispatch([
            hideFloatPopup(),
            updateFeedActiveTab(FOLLOWED_TAB),
            hideGlobalSearchPopup(),
            setGlobalSearchResults(null),
            navigateToAllProjectsTasks(),
        ])
    }

    return (
        <TouchableOpacity
            style={[
                ...(highlight
                    ? [localStyles.containerActive, theme.containerActive]
                    : [localStyles.containerInactive, theme.containerInactive]),
                !expanded && localStyles.containerCollapsed,
                !highlight && hover && theme.containerActive,
            ]}
            onPress={onPress}
            onMouseEnter={onHover}
            onMouseLeave={offHover}
        >
            {showShortcut && <ItemShortcut shortcut={'0'} />}

            <View style={localStyles.innerContainer}>
                <Image source={{ uri: loggedUserPhotoURL }} style={localStyles.userImage} />
                {expanded && (
                    <Text
                        style={
                            inAllProjects
                                ? [localStyles.title, theme.title]
                                : [localStyles.titleInactive, theme.titleInactive]
                        }
                    >
                        {translate('All projects')}
                    </Text>
                )}
            </View>

            {!inAllProjects && <AmountBadgeContainer />}
        </TouchableOpacity>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
    },
    containerActive: {
        paddingLeft: 24,
        alignItems: 'center',
        flexDirection: 'row',
        height: 56,
        justifyContent: 'space-between',
    },
    containerInactive: {
        paddingLeft: 24,
        opacity: 0.8,
        alignItems: 'center',
        flexDirection: 'row',
        height: 56,
        justifyContent: 'space-between',
    },

    containerCollapsed: {
        paddingLeft: 17,
    },
    innerContainer: {
        alignItems: 'center',
        flexDirection: 'row',
    },
    userImage: {
        height: 22,
        width: 22,
        borderRadius: 100,
        marginRight: 10,
    },
    title: {
        ...styles.subtitle1,
    },
    titleInactive: {
        fontFamily: 'Roboto-Regular',
        fontSize: 16,
        lineHeight: 24,
        letterSpacing: em2px(0.02),
    },
})
