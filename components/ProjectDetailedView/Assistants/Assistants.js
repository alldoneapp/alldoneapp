import React, { useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector, useDispatch } from 'react-redux'

import Header from './Header'
import URLsProjects, { URL_PROJECT_DETAILS_ASSISTANTS } from '../../../URLSystem/Projects/URLsProjects'
import { DV_TAB_PROJECT_ASSISTANTS, DV_TAB_ROOT_TASKS } from '../../../utils/TabNavigationConstants'
import AssistantsList from '../../AdminPanel/Assistants/AssistantsList'
import store from '../../../redux/store'
import {
    hideWebSideBar,
    resetLoadingData,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    setTaskViewToggleIndex,
    setTaskViewToggleSection,
    storeCurrentShortcutUser,
    storeCurrentUser,
    switchProject,
} from '../../../redux/actions'
import AddAssistantWrapper from './AddAssistantWrapper'
import { setAssistantLastVisitedBoardDate } from '../../../utils/backends/Assistants/assistantsFirestore'
import { GLOBAL_PROJECT_ID, isGlobalAssistant } from '../../AdminPanel/Assistants/assistantsHelper'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import NavigationService from '../../../utils/NavigationService'

export default function Assistants({ project, accessGranted }) {
    const dispatch = useDispatch()
    const selectedTab = useSelector(state => state.selectedNavItem)
    const globalAssistants = useSelector(state => state.globalAssistants)
    const assistants = useSelector(state => state.projectAssistants[project.id])
    const dismissibleRefs = useRef({})
    const addAssistantWrapperRef = useRef()

    const setDismissibleRefs = (ref, dismissibleId) => {
        if (ref) dismissibleRefs.current[dismissibleId] = ref
    }

    const openEdition = dismissibleId => {
        const { showFloatPopup } = store.getState()
        if (showFloatPopup === 0) closeAllEdition()
        if (!checkIfAnyDismissibleIsOpen()) dismissibleRefs.current[dismissibleId].openModal()
    }

    const closeEdition = dismissibleId => {
        dismissibleRefs.current[dismissibleId].closeModal()
    }

    const closeAllEdition = () => {
        for (let dismissibleId in dismissibleRefs.current) {
            if (dismissibleRefs.current[dismissibleId].modalIsVisible()) closeEdition(dismissibleId)
        }
    }

    const checkIfAnyDismissibleIsOpen = () => {
        for (let dismissibleId in dismissibleRefs.current) {
            if (dismissibleRefs.current[dismissibleId].modalIsVisible()) return true
        }
        return false
    }

    const writeBrowserURL = () => {
        if (selectedTab === DV_TAB_PROJECT_ASSISTANTS) {
            const data = { projectId: project.id }
            URLsProjects.push(URL_PROJECT_DETAILS_ASSISTANTS, data, project.id)
        }
    }

    const navigateToAssistantBoard = assistant => {
        const { showFloatPopup, loggedUser, smallScreenNavigation } = store.getState()
        if (showFloatPopup === 0) {
            NavigationService.navigate('Root')

            setAssistantLastVisitedBoardDate(
                isGlobalAssistant(assistant.uid) ? GLOBAL_PROJECT_ID : project.id,
                assistant,
                project.id,
                'lastVisitBoard'
            )

            let dispatches = [
                setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
                storeCurrentUser(assistant),
                setSelectedTypeOfProject(ProjectHelper.getTypeOfProject(loggedUser, project.id)),
                storeCurrentShortcutUser(null),
                setTaskViewToggleIndex(0),
                setTaskViewToggleSection('Open'),
                switchProject(project.index),
            ]

            if (smallScreenNavigation) dispatches.push(hideWebSideBar())

            dispatch(dispatches)
        }
    }

    useEffect(() => {
        writeBrowserURL()
        // Check if navigation came from "Add AI Assistant" click
        const { navigationSource } = store.getState()
        if (navigationSource === 'ADD_AI_ASSISTANT' && addAssistantWrapperRef.current) {
            // Reset the navigation source
            dispatch({ type: 'RESET_NAVIGATION_SOURCE' })
            // Open the popup after a small delay to ensure component is fully mounted
            setTimeout(() => {
                addAssistantWrapperRef.current.openModal()
            }, 100)
        }
    }, [])

    useEffect(() => {
        return () => {
            store.dispatch(resetLoadingData())
        }
    }, [])

    const assistantsToShow = [
        ...globalAssistants.filter(assistant => project.globalAssistantIds.includes(assistant.uid)),
        ...assistants,
    ]

    return (
        <View style={localStyles.container}>
            <Header amount={assistantsToShow.length} />
            {accessGranted && <AddAssistantWrapper ref={addAssistantWrapperRef} project={project} />}
            <AssistantsList
                projectId={project.id}
                assistants={assistantsToShow}
                setDismissibleRefs={setDismissibleRefs}
                closeEdition={closeEdition}
                onAssistantClick={navigateToAssistantBoard}
                project={project}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flex: 1,
    },
})
