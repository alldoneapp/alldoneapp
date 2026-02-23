import React, { useEffect, useState } from 'react'
import { Dimensions, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import PropTypes from 'prop-types'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors, SCREEN_BREAKPOINT_NAV } from '../../styles/global'
import { translate } from '../../../i18n/TranslationService'
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

export default function MainSectionTabsHeader({ showSectionToggle, renderSectionToggle, renderRightAccessory }) {
    const dispatch = useDispatch()
    const selectedSidebarTab = useSelector(state => state.selectedSidebarTab)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const project = useSelector(state => state.loggedUserProjects[selectedProjectIndex])
    const realProjectIds = useSelector(state => state.loggedUser.realProjectIds)
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const getViewportWidth = () =>
        typeof window !== 'undefined' && typeof window.innerWidth === 'number'
            ? window.innerWidth
            : Dimensions.get('window').width
    const [viewportWidth, setViewportWidth] = useState(getViewportWidth())

    const useMobileLayout = viewportWidth < SCREEN_BREAKPOINT_NAV
    const useCompactDesktopTabs = !useMobileLayout && viewportWidth < 1500
    const tabs = [
        { text: 'Tasks', value: DV_TAB_ROOT_TASKS },
        { text: 'Goals', value: DV_TAB_ROOT_GOALS },
        { text: 'Notes', value: DV_TAB_ROOT_NOTES },
        { text: 'Contacts', value: DV_TAB_ROOT_CONTACTS },
        { text: 'Chats', value: DV_TAB_ROOT_CHATS },
    ]

    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)
    const accessGranted = !isAnonymous && (inAllProjects || (project && realProjectIds.includes(project.id)))
    const sectionToggle = showSectionToggle && renderSectionToggle ? renderSectionToggle() : null
    const rightAccessory = renderRightAccessory ? renderRightAccessory() : null
    const showRightArea = !!sectionToggle || !!rightAccessory

    useEffect(() => {
        const onResize = () => setViewportWidth(getViewportWidth())

        if (typeof window !== 'undefined') {
            window.addEventListener('resize', onResize)
            return () => window.removeEventListener('resize', onResize)
        }

        const subscription = Dimensions.addEventListener('change', onResize)
        return () => {
            if (subscription && subscription.remove) subscription.remove()
        }
    }, [])

    const onPressSectionTab = sectionValue => {
        if (sectionValue === selectedSidebarTab || !accessGranted) return

        const { loggedUser } = store.getState()
        dismissAllPopups(true, true, true)

        const actionsToDispatch = [hideFloatPopup(), setSelectedSidebarTab(sectionValue)]
        if (useMobileLayout) actionsToDispatch.push(hideWebSideBar())

        const isGuide = ProjectHelper.checkIfProjectIsGuide(selectedProjectIndex)
        let newCurrentUser = loggedUser

        if (!isGuide && sectionValue === DV_TAB_ROOT_GOALS && checkIfSelectedProject(selectedProjectIndex)) {
            newCurrentUser = allGoals
        }

        actionsToDispatch.push(storeCurrentUser(newCurrentUser))
        dispatch(actionsToDispatch)
    }

    return (
        <View style={localStyles.container}>
            {useMobileLayout ? (
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

                    {showRightArea && (
                        <View style={localStyles.mobileControlsContainer}>
                            {sectionToggle && <View style={localStyles.sectionToggleRowMobile}>{sectionToggle}</View>}
                            {rightAccessory && (
                                <View style={localStyles.rightAccessoryRowMobile}>{rightAccessory}</View>
                            )}
                        </View>
                    )}
                </View>
            ) : (
                <View style={[localStyles.controlsRow, showRightArea && localStyles.controlsRowWithRight]}>
                    <View style={localStyles.tabsRow}>
                        <View style={[localStyles.tabsContainer, !accessGranted && localStyles.tabsContainerDisabled]}>
                            {tabs.map(tab => {
                                const selected = selectedSidebarTab === tab.value
                                return (
                                    <TouchableOpacity
                                        key={tab.value}
                                        style={[
                                            localStyles.tabButton,
                                            useCompactDesktopTabs && localStyles.tabButtonCompactDesktop,
                                            selected && localStyles.tabButtonSelected,
                                        ]}
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

                    {showRightArea && (
                        <View style={localStyles.rightArea}>
                            {sectionToggle && (
                                <View
                                    style={[
                                        localStyles.sectionToggleRow,
                                        useCompactDesktopTabs && localStyles.sectionToggleRowCompactDesktop,
                                    ]}
                                >
                                    {sectionToggle}
                                </View>
                            )}
                            {rightAccessory && <View style={localStyles.rightAccessoryRow}>{rightAccessory}</View>}
                        </View>
                    )}
                </View>
            )}
        </View>
    )
}

MainSectionTabsHeader.propTypes = {
    showSectionToggle: PropTypes.bool,
    renderSectionToggle: PropTypes.func,
    renderRightAccessory: PropTypes.func,
}

MainSectionTabsHeader.defaultProps = {
    showSectionToggle: false,
    renderSectionToggle: null,
    renderRightAccessory: null,
}

const localStyles = StyleSheet.create({
    container: {
        width: '100%',
        justifyContent: 'center',
        alignItems: 'stretch',
        paddingTop: 24,
        paddingBottom: 26,
    },
    controlsRow: {
        width: '100%',
        backgroundColor: colors.UtilityBlue100,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.UtilityBlue125,
        paddingHorizontal: 10,
        paddingVertical: 8,
        shadowColor: '#04142F',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 10,
        elevation: 2,
    },
    controlsRowWithRight: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    controlsRowMobile: {
        width: '100%',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'flex-start',
        backgroundColor: colors.UtilityBlue100,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.UtilityBlue125,
        paddingHorizontal: 10,
        paddingVertical: 8,
        shadowColor: '#04142F',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.08,
        shadowRadius: 10,
        elevation: 2,
    },
    tabsRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        flex: 1,
        minWidth: 0,
    },
    tabsContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingHorizontal: 0,
        paddingVertical: 0,
    },
    tabsContainerMobile: {
        paddingHorizontal: 0,
        minWidth: '100%',
        flexGrow: 1,
        justifyContent: 'center',
    },
    tabsContainerDisabled: {
        opacity: 0.6,
    },
    tabButton: {
        height: 36,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 14,
        marginHorizontal: 2,
        borderBottomWidth: 3,
        borderBottomColor: 'transparent',
    },
    tabButtonCompactDesktop: {
        paddingHorizontal: 8,
        marginHorizontal: 0,
    },
    tabButtonMobile: {
        height: 38,
        paddingHorizontal: 10,
        marginHorizontal: 0,
    },
    tabButtonSelected: {
        borderBottomColor: colors.Primary100,
    },
    tabText: {
        ...styles.subtitle1,
        color: colors.Text02,
    },
    tabTextMobile: {
        ...styles.subtitle1,
    },
    tabTextSelected: {
        color: colors.Text01,
        fontFamily: 'Roboto-Medium',
    },
    rightArea: {
        marginLeft: 12,
        flexDirection: 'row',
        alignItems: 'center',
    },
    sectionToggleRow: {
        marginRight: 10,
    },
    sectionToggleRowCompactDesktop: {
        marginRight: 6,
    },
    rightAccessoryRow: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    mobileControlsContainer: {
        alignItems: 'center',
        justifyContent: 'center',
    },
    sectionToggleRowMobile: {
        marginTop: 14,
        alignSelf: 'center',
    },
    rightAccessoryRowMobile: {
        marginTop: 12,
        alignSelf: 'center',
        flexDirection: 'row',
        alignItems: 'center',
    },
})
