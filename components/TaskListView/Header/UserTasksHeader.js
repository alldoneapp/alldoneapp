import React, { useState } from 'react'
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import PropTypes from 'prop-types'
import { useSelector, useDispatch } from 'react-redux'

import styles, { colors } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
import TasksMultiToggleSwitch from '../TasksMultiToggleSwitch'
import ProjectHelper, {
    checkIfSelectedAllProjects,
    checkIfSelectedProject,
} from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { hideFloatPopup, hideWebSideBar, setSelectedSidebarTab, storeCurrentUser } from '../../../redux/actions'
import store from '../../../redux/store'
import { dismissAllPopups } from '../../../utils/HelperFunctions'
import {
    DV_TAB_ROOT_CHATS,
    DV_TAB_ROOT_CONTACTS,
    DV_TAB_ROOT_GOALS,
    DV_TAB_ROOT_NOTES,
    DV_TAB_ROOT_TASKS,
} from '../../../utils/TabNavigationConstants'
import { allGoals } from '../../AllSections/allSectionHelper'

const UserTasksHeader = ({ showSectionToggle }) => {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const project = useSelector(state => state.loggedUserProjects[selectedProjectIndex])
    const realProjectIds = useSelector(state => state.loggedUser.realProjectIds)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const [tabs] = useState([
        { text: 'Tasks', value: DV_TAB_ROOT_TASKS },
        { text: 'Goals', value: DV_TAB_ROOT_GOALS },
        { text: 'Notes', value: DV_TAB_ROOT_NOTES },
        { text: 'Contacts', value: DV_TAB_ROOT_CONTACTS },
        { text: 'Chats', value: DV_TAB_ROOT_CHATS },
    ])

    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)
    const accessGranted = !isAnonymous && (inAllProjects || (project && realProjectIds.includes(project.id)))

    const onPressSectionTab = sectionValue => {
        if (sectionValue === selectedSidebarTab || !accessGranted) return

        const { loggedUser } = store.getState()
        dismissAllPopups(true, true, true)

        const actionsToDispatch = [hideFloatPopup(), setSelectedSidebarTab(sectionValue)]

        if (smallScreenNavigation) actionsToDispatch.push(hideWebSideBar())

        const isGuide = ProjectHelper.checkIfProjectIsGuide(selectedProjectIndex)
        let newCurrentUser = loggedUser

        if (!isGuide && sectionValue === DV_TAB_ROOT_GOALS && checkIfSelectedProject(selectedProjectIndex)) {
            newCurrentUser = allGoals
        }

        actionsToDispatch.push(storeCurrentUser(newCurrentUser))
        dispatch(actionsToDispatch)
    }

    return (
        <View
            style={[
                localStyles.container,
                smallScreenNavigation
                    ? localStyles.headerTextForMobile
                    : isMiddleScreen && localStyles.headerTextForTablet,
            ]}
        >
            {smallScreenNavigation ? (
                <View style={localStyles.controlsRowMobile}>
                    <ScrollView
                        horizontal={true}
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={[
                            localStyles.tabsContainer,
                            localStyles.tabsContainerMobile,
                            !accessGranted && localStyles.tabsContainerDisabled,
                        ]}
                    >
                        {tabs.map(tab => {
                            const selected = selectedSidebarTab === tab.value
                            return (
                                <TouchableOpacity
                                    key={tab.value}
                                    style={[
                                        localStyles.tabButton,
                                        localStyles.tabButtonMobile,
                                        selected && localStyles.tabButtonSelected,
                                    ]}
                                    onPress={() => onPressSectionTab(tab.value)}
                                    disabled={!accessGranted}
                                    accessible={false}
                                >
                                    <Text
                                        style={[
                                            localStyles.tabText,
                                            localStyles.tabTextMobile,
                                            selected && localStyles.tabTextSelected,
                                        ]}
                                    >
                                        {translate(tab.text)}
                                    </Text>
                                </TouchableOpacity>
                            )
                        })}
                    </ScrollView>

                    {showSectionToggle && (
                        <View style={localStyles.sectionToggleRowMobile}>
                            <TasksMultiToggleSwitch />
                        </View>
                    )}
                </View>
            ) : (
                <View style={[localStyles.controlsRow, showSectionToggle && localStyles.controlsRowWithSwitch]}>
                    <View style={localStyles.tasksRow}>
                        <View style={[localStyles.tabsContainer, !accessGranted && localStyles.tabsContainerDisabled]}>
                            {tabs.map(tab => {
                                const selected = selectedSidebarTab === tab.value
                                return (
                                    <TouchableOpacity
                                        key={tab.value}
                                        style={[localStyles.tabButton, selected && localStyles.tabButtonSelected]}
                                        onPress={() => onPressSectionTab(tab.value)}
                                        disabled={!accessGranted}
                                        accessible={false}
                                    >
                                        <Text style={[localStyles.tabText, selected && localStyles.tabTextSelected]}>
                                            {translate(tab.text)}
                                        </Text>
                                    </TouchableOpacity>
                                )
                            })}
                        </View>
                    </View>

                    {showSectionToggle && (
                        <View style={localStyles.sectionToggleRow}>
                            <TasksMultiToggleSwitch />
                        </View>
                    )}
                </View>
            )}
        </View>
    )
}

UserTasksHeader.propTypes = {
    style: PropTypes.any,
    showSectionToggle: PropTypes.bool,
}

UserTasksHeader.defaultProps = {
    showSectionToggle: true,
}

export function getFormattedName(fullName) {
    if (fullName === 'Loading...') {
        return fullName
    }

    let name = fullName.split(' ')[0]

    if (name[name.length - 1] === 's') {
        return name + `' tasks`
    }

    return name + `'s tasks`
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
        justifyContent: 'center',
        alignItems: 'stretch',
        paddingTop: 30,
        paddingBottom: 30,
    },
    controlsRow: {
        width: '100%',
    },
    controlsRowWithSwitch: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    controlsRowMobile: {
        width: '100%',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'flex-start',
    },
    tasksRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        flex: 1,
    },
    headerTextForMobile: {
        paddingHorizontal: 16,
    },
    headerTextForTablet: {
        paddingHorizontal: 56,
    },
    tabsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingHorizontal: 0,
    },
    tabsContainerMobile: {
        paddingHorizontal: 0,
        minWidth: '100%',
    },
    tabsContainerDisabled: {
        opacity: 0.6,
    },
    tabButton: {
        height: 38,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 12,
        marginHorizontal: 2,
        borderBottomWidth: 2,
        borderBottomColor: 'transparent',
    },
    tabButtonMobile: {
        height: 34,
        paddingHorizontal: 10,
        marginHorizontal: 1,
    },
    tabButtonSelected: {
        borderBottomColor: colors.Primary100,
    },
    tabText: {
        ...styles.subtitle1,
        color: '#6B778C',
    },
    tabTextMobile: {
        fontSize: 12,
    },
    tabTextSelected: {
        color: colors.Primary100,
        fontFamily: 'Roboto-Medium',
    },
    sectionToggleRow: {
        marginTop: 0,
        marginBottom: 0,
        marginLeft: 16,
    },
    sectionToggleRowMobile: {
        marginTop: 22,
        alignSelf: 'center',
    },
})

export default UserTasksHeader
