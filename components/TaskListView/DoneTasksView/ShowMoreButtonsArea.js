import React from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { View, StyleSheet } from 'react-native'

import ShowMoreButton from '../../UIControls/ShowMoreButton'
import {
    hideFloatPopup,
    hideWebSideBar,
    setAmountTasksExpanded,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    switchProject,
    setShowLimitedFeatureModal,
} from '../../../redux/actions'
import ProjectHelper, { checkIfSelectedProject } from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { dismissAllPopups } from '../../../utils/HelperFunctions'
import { DV_TAB_ROOT_TASKS } from '../../../utils/TabNavigationConstants'
import { AMOUNT_OF_EARLIER_TASKS_TO_SHOW_WHEN_PRESS_BUTTON } from '../../../utils/backends/doneTasks'
import store from '../../../redux/store'
import useNeedShowMoreButton from './useNeedShowMoreButton'
import { PLAN_STATUS_PREMIUM } from '../../Premium/PremiumHelper'

export default function ShowMoreButtonsArea({
    filteredTasksByDateAmount,
    projectId,
    projectIndex,
    completedDateToCheck,
}) {
    const dispatch = useDispatch()
    const amountDoneTasksExpanded = useSelector(state => state.amountDoneTasksExpanded)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const premiumStatus = useSelector(state => state.loggedUser.premium.status)
    const needShowMoreButton = useNeedShowMoreButton(projectId, completedDateToCheck)

    const nagivateToProjectAndExpand = () => {
        const { currentUser, smallScreenNavigation } = store.getState()
        const projectType = ProjectHelper.getTypeOfProject(currentUser, projectId)
        dismissAllPopups(true, true, true)
        const actionsToDispatch = [
            hideFloatPopup(),
            setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
            switchProject(projectIndex),
            setSelectedTypeOfProject(projectType),
            setAmountTasksExpanded(AMOUNT_OF_EARLIER_TASKS_TO_SHOW_WHEN_PRESS_BUTTON),
        ]

        if (smallScreenNavigation) actionsToDispatch.push(hideWebSideBar())
        dispatch(actionsToDispatch)
    }

    const expandTasks = () => {
        checkIfSelectedProject(selectedProjectIndex)
            ? premiumStatus === PLAN_STATUS_PREMIUM || amountDoneTasksExpanded === 0
                ? dispatch(
                      setAmountTasksExpanded(
                          amountDoneTasksExpanded + AMOUNT_OF_EARLIER_TASKS_TO_SHOW_WHEN_PRESS_BUTTON
                      )
                  )
                : dispatch(setShowLimitedFeatureModal(true))
            : nagivateToProjectAndExpand()
    }

    const contractTasks = () => {
        dispatch(setAmountTasksExpanded(amountDoneTasksExpanded - AMOUNT_OF_EARLIER_TASKS_TO_SHOW_WHEN_PRESS_BUTTON))
    }

    return needShowMoreButton || amountDoneTasksExpanded > 0 ? (
        <View style={[localStyles.container, filteredTasksByDateAmount === 0 && { marginTop: 8 }]}>
            {needShowMoreButton && (
                <ShowMoreButton
                    expanded={false}
                    expand={expandTasks}
                    expandText={'earlier tasks'}
                    style={{ flex: 0, marginRight: 16 }}
                />
            )}
            {amountDoneTasksExpanded > 0 && (
                <ShowMoreButton
                    expanded={true}
                    contract={contractTasks}
                    contractText={'hide earlier tasks'}
                    style={{ flex: 0 }}
                />
            )}
        </View>
    ) : null
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        justifyContent: 'center',
    },
})
