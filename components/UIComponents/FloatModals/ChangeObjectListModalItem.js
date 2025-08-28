import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import Hotkeys from 'react-hot-keys'
import { useDispatch, useSelector } from 'react-redux'

import styles from '../../styles/global'
import Icon from '../../Icon'
import { dismissAllPopups } from '../../../utils/HelperFunctions'
import Shortcut, { SHORTCUT_LIGHT } from '../../UIControls/Shortcut'
import { translate } from '../../../i18n/TranslationService'
import {
    hideFloatPopup,
    hideWebSideBar,
    navigateToUpdates,
    setSelectedSidebarTab,
    storeCurrentUser,
} from '../../../redux/actions'
import store from '../../../redux/store'
import { DV_TAB_ROOT_GOALS, DV_TAB_ROOT_UPDATES } from '../../../utils/TabNavigationConstants'
import ProjectHelper, {
    ALL_PROJECTS_INDEX,
    checkIfSelectedProject,
} from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { allGoals } from '../../AllSections/allSectionHelper'

export default function ChangeObjectListModalItem({ sectionItem, closePopover }) {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)

    const selected = sectionItem.value === selectedSidebarTab

    const onPress = e => {
        if (e != null) {
            e.preventDefault()
            e.stopPropagation()
        }

        if (!selected) {
            const { loggedUser } = store.getState()
            dismissAllPopups(true, true, true)
            const actionsToDispatch = [hideFloatPopup()]

            if (sectionItem.value === DV_TAB_ROOT_UPDATES) {
                actionsToDispatch.push(
                    navigateToUpdates({
                        selectedProjectIndex: checkIfSelectedProject(selectedProjectIndex)
                            ? selectedProjectIndex
                            : ALL_PROJECTS_INDEX,
                    })
                )
            } else {
                actionsToDispatch.push(setSelectedSidebarTab(sectionItem.value))
            }

            if (smallScreenNavigation) actionsToDispatch.push(hideWebSideBar())

            const isGuide = ProjectHelper.checkIfProjectIsGuide(selectedProjectIndex)

            let newCurrentUser = loggedUser
            if (!isGuide && sectionItem.value === DV_TAB_ROOT_GOALS && checkIfSelectedProject(selectedProjectIndex)) {
                newCurrentUser = allGoals
            }

            actionsToDispatch.push(storeCurrentUser(newCurrentUser))

            dispatch(actionsToDispatch)
        }
        closePopover()
    }

    return (
        <View>
            <Hotkeys keyName={sectionItem.shortcut} onKeyDown={(sht, event) => onPress(event)} filter={e => true}>
                <TouchableOpacity style={localStyles.themeSectionItem} onPress={onPress}>
                    <View style={localStyles.themeSectionItem}>
                        <View style={localStyles.sectionItemText}>
                            <Icon name={sectionItem.icon} size={24} color={'#ffffff'} />
                            <Text style={[styles.subtitle1, { color: '#ffffff', marginLeft: 8 }]}>
                                {translate(sectionItem.text)}
                            </Text>
                        </View>
                        <View style={localStyles.sectionItemCheck}>
                            {selected && <Icon name={'check'} size={24} color={'#ffffff'} />}
                            {!smallScreenNavigation && (
                                <Shortcut
                                    text={sectionItem.shortcut}
                                    theme={SHORTCUT_LIGHT}
                                    containerStyle={{ marginLeft: 4 }}
                                />
                            )}
                        </View>
                    </View>
                </TouchableOpacity>
            </Hotkeys>
        </View>
    )
}

const localStyles = StyleSheet.create({
    themeSectionItem: {
        flex: 1,
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
        overflow: 'visible',
    },
    sectionItemText: {
        flexDirection: 'row',
        flexGrow: 1,
    },
    sectionItemCheck: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
    },
})
