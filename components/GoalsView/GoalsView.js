import React, { useCallback, useEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { checkIfSelectedAllProjects } from '../SettingsView/ProjectsSettings/ProjectHelper'
import { GOALS_OPEN_TAB_INDEX } from './GoalsHelper'
import {
    resetLoadingData,
    setForceCloseGoalEditionId,
    setGoalsActiveTab,
    setNavigationRoute,
} from '../../redux/actions'

import {
    exitsOpenModals,
    TASK_DESCRIPTION_MODAL_ID,
    GOAL_PROGRESS_MODAL_ID,
    GOAL_ASSIGNEES_MODAL_ID,
    GOAL_MILESTONE_MODAL_ID,
    GOAL_DATE_RANGE_MODAL_ID,
    GLOBAL_SEARCH_MODAL_ID,
    COMMENT_MODAL_ID,
    PRIVACY_MODAL_ID,
} from '../ModalsManager/modalsManager'
import HashtagFiltersView from '../HashtagFilters/HashtagFiltersView'
import GoalsViewSelectedProject from './GoalsViewSelectedProject'
import GoalsViewAllProjects from './GoalsViewAllProjects'
import store from '../../redux/store'
import { DV_TAB_ROOT_GOALS } from '../../utils/TabNavigationConstants'
import AllProjectsLine from '../TaskListView/Header/AllProjectsLine/AllProjectsLine'

export default function GoalsView() {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const loggedUserProjectsAmount = useSelector(state => state.loggedUserProjects.length)
    const activeDragGoalMode = useSelector(state => state.activeDragGoalMode)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const goalsActiveTab = useSelector(state => state.goalsActiveTab)
    const forceCloseGoalEditionId = useSelector(state => state.forceCloseGoalEditionId)
    const dismissibleRefs = useRef({})

    // These only ever touch a ref and the store, so they are stable for the lifetime of the view.
    // Keeping their identity stable is what lets `React.memo(MilestonesListByProject)` actually
    // bail out of re-rendering every project row (AT-2336).
    const setDismissibleRefs = useCallback((ref, dismissibleId) => {
        if (ref) dismissibleRefs.current[dismissibleId] = ref
    }, [])

    const unsetDismissibleRefs = useCallback(dismissibleId => {
        delete dismissibleRefs?.current?.[dismissibleId]
    }, [])

    const closeEdition = useCallback(dismissibleId => {
        if (
            !exitsOpenModals([
                TASK_DESCRIPTION_MODAL_ID,
                GOAL_PROGRESS_MODAL_ID,
                GOAL_ASSIGNEES_MODAL_ID,
                GOAL_MILESTONE_MODAL_ID,
                GOAL_DATE_RANGE_MODAL_ID,
                GLOBAL_SEARCH_MODAL_ID,
                COMMENT_MODAL_ID,
                PRIVACY_MODAL_ID,
            ])
        ) {
            dismissibleRefs.current[dismissibleId].closeModal()
        }
    }, [])

    const closeAllEdition = useCallback(() => {
        for (let dismissibleId in dismissibleRefs.current) {
            if (dismissibleRefs.current[dismissibleId].modalIsVisible()) closeEdition(dismissibleId)
        }
    }, [closeEdition])

    const checkIfAnyDismissibleIsOpen = useCallback(() => {
        for (let dismissibleId in dismissibleRefs.current) {
            if (dismissibleRefs.current[dismissibleId].modalIsVisible()) return true
        }
        return false
    }, [])

    const openEdition = useCallback(
        dismissibleId => {
            const { showFloatPopup } = store.getState()
            if (showFloatPopup === 0) closeAllEdition()
            if (!checkIfAnyDismissibleIsOpen()) dismissibleRefs.current[dismissibleId].openModal()
        },
        [closeAllEdition, checkIfAnyDismissibleIsOpen]
    )

    useEffect(() => {
        if (dismissibleRefs.current[forceCloseGoalEditionId]) {
            closeEdition(forceCloseGoalEditionId)
            dispatch(setForceCloseGoalEditionId(''))
        }
    }, [forceCloseGoalEditionId])

    useEffect(() => {
        setTimeout(() => {
            dispatch(resetLoadingData())
        })
        return () => {
            dispatch(resetLoadingData())
        }
    }, [loggedUserProjectsAmount, currentUserId, selectedProjectIndex, goalsActiveTab])

    useEffect(() => {
        dispatch(setNavigationRoute(DV_TAB_ROOT_GOALS))
    }, [])

    useEffect(() => {
        return () => {
            dispatch(setGoalsActiveTab(GOALS_OPEN_TAB_INDEX))
        }
    }, [])

    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)

    return (
        <View
            style={[
                localStyles.container,
                inAllProjects && localStyles.containerSpace,
                smallScreenNavigation ? localStyles.containerMobile : isMiddleScreen && localStyles.containerTablet,
                activeDragGoalMode && { marginBottom: 48 },
            ]}
        >
            {inAllProjects && <AllProjectsLine showActions={false} />}
            <HashtagFiltersView />

            {inAllProjects ? (
                <GoalsViewAllProjects
                    openEdition={openEdition}
                    closeEdition={closeEdition}
                    unsetDismissibleRefs={unsetDismissibleRefs}
                    setDismissibleRefs={setDismissibleRefs}
                />
            ) : (
                <GoalsViewSelectedProject
                    openEdition={openEdition}
                    closeEdition={closeEdition}
                    unsetDismissibleRefs={unsetDismissibleRefs}
                    setDismissibleRefs={setDismissibleRefs}
                />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginHorizontal: 104,
    },
    containerSpace: {
        marginBottom: 32,
    },
    containerMobile: {
        marginHorizontal: 16,
    },
    containerTablet: {
        marginHorizontal: 56,
    },
})
