import React, { useState } from 'react'
import { useDispatch } from 'react-redux'

import CustomScrollView from '../../../UIControls/CustomScrollView'
import store from '../../../../redux/store'
import { hideFloatPopup, navigateToGoals, setGoalsShowMoreExpanded, showFloatPopup } from '../../../../redux/actions'
import { FEED_GOAL_OBJECT_TYPE } from '../../../Feeds/Utils/FeedsConstants'
import PrivacyModal from '../PrivacyModal/PrivacyModal'
import MainModal from './MainModal'
import {
    BASE_NUMBER_OF_MILESTONES_TO_SHOW_SELECTED_PROJECT,
    getNewDefaultGoal,
    getOwnerId,
} from '../../../GoalsView/GoalsHelper'
import GoalMilestoneRangeModal from '../GoalMilestoneRangeModal/GoalMilestoneRangeModal'
import Backend from '../../../../utils/BackendBridge'
import { BACKLOG_DATE_NUMERIC } from '../../../TaskListView/Utils/TasksHelper'
import GoalAssigneesModal from '../GoalAssigneesModal/GoalAssigneesModal'
import HighlightColorModal from '../HighlightColorModal/HighlightColorModal'
import DescriptionModal from '../DescriptionModal/DescriptionModal'
import { getActiveMilestone, getNextMilestones } from '../../../../utils/backends/Goals/goalsFirestore'
import ProjectHelper, { checkIfSelectedAllProjects } from '../../../SettingsView/ProjectsSettings/ProjectHelper'

const getNewInitialDefaultGoal = projectId => {
    const newGoal = getNewDefaultGoal(BACKLOG_DATE_NUMERIC)
    newGoal.ownerId = getOwnerId(projectId, newGoal.assigneesIds[0])
    return newGoal
}

export default function RichCreateGoalModal({ projectId, closeModal }) {
    const dispatch = useDispatch()
    const [showDateRangeModal, setShowDateRangeModal] = useState(false)
    const [showAssigneeModal, setShowAssigneeModal] = useState(false)
    const [showPrivacyModal, setShowPrivacyModal] = useState(false)
    const [showDescriptionModal, setShowDescriptionModal] = useState(false)
    const [showHighlightModal, setShowHighlightModal] = useState(false)
    const [goal, setGoal] = useState(() => {
        return getNewInitialDefaultGoal(projectId)
    })

    const showDateRange = () => {
        if (!showDateRangeModal) {
            setShowDateRangeModal(true)
            dispatch(showFloatPopup())
        }
    }

    const showPrivacy = () => {
        if (!showPrivacyModal) {
            setShowPrivacyModal(true)
            dispatch(showFloatPopup())
        }
    }

    const showAssignees = () => {
        if (!showAssigneeModal) {
            setShowAssigneeModal(true)
            store.dispatch(showFloatPopup())
        }
    }

    const showDescription = () => {
        if (!showDescriptionModal) {
            setShowDescriptionModal(true)
            store.dispatch(showFloatPopup())
        }
    }

    const showHighlight = () => {
        if (!showHighlightModal) {
            setShowHighlightModal(true)
            store.dispatch(showFloatPopup())
        }
    }

    const savePrivacy = (isPrivate, isPublicFor) => {
        setGoal({ ...goal, isPublicFor })
        setShowPrivacyModal(false)
        dispatch(hideFloatPopup())
    }

    const saveDescription = description => {
        setGoal({ ...goal, description: description.trim() })
        setShowDescriptionModal(false)
        dispatch(hideFloatPopup())
    }

    const saveDateRange = (date, rangeEdgePropertyName) => {
        setGoal({ ...goal, [rangeEdgePropertyName]: date })
        setShowDateRangeModal(false)
        dispatch(hideFloatPopup())
    }

    const saveAssignee = (assigneesIds, assigneesCapacity) => {
        if (assigneesIds.length > 0) {
            setGoal({ ...goal, assigneesIds, assigneesCapacity, ownerId: getOwnerId(projectId, assigneesIds[0]) })
        }
        setShowAssigneeModal(false)
        dispatch(hideFloatPopup())
    }

    const saveHighlight = (e, data) => {
        setGoal({ ...goal, hasStar: data.color })
        setShowHighlightModal(false)
        dispatch(hideFloatPopup())
    }

    const delayClosePopup = () => {
        setTimeout(async () => {
            setShowPrivacyModal(false)
            setShowDateRangeModal(false)
            setShowAssigneeModal(false)
            setShowHighlightModal(false)
            setShowDescriptionModal(false)
            dispatch(hideFloatPopup())
        })
    }

    const createGoal = () => {
        if (goal.name.length > 0) {
            closeModal()
            Backend.uploadNewGoal(projectId, goal, BACKLOG_DATE_NUMERIC, true, false).then(finalGoal => {
                tryExpandGoalsList(finalGoal)
            })
        }
    }

    const tryExpandGoalInSelectedProject = (nextMilestones, finalGoal) => {
        if (
            nextMilestones.length === BASE_NUMBER_OF_MILESTONES_TO_SHOW_SELECTED_PROJECT &&
            nextMilestones[BASE_NUMBER_OF_MILESTONES_TO_SHOW_SELECTED_PROJECT - 1].date <
                finalGoal.startingMilestoneDate
        ) {
            dispatch(setGoalsShowMoreExpanded(true))
        }
    }

    const tryExpandGoalsList = async finalGoal => {
        const { loggedUser, selectedProjectIndex, goalsShowMoreExpanded } = store.getState()

        const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)
        const nextMilestones = await getNextMilestones(
            projectId,
            finalGoal.ownerId,
            BASE_NUMBER_OF_MILESTONES_TO_SHOW_SELECTED_PROJECT
        )

        if (nextMilestones.length > 0) {
            if (inAllProjects) {
                if (nextMilestones[0].date < finalGoal.startingMilestoneDate) {
                    const project = ProjectHelper.getProjectById(projectId)
                    const projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId)
                    dispatch(
                        navigateToGoals({
                            selectedProjectIndex: project.index,
                            selectedTypeOfProject: projectType,
                            shortcutSelectedProjectIndex: project.index,
                        })
                    )
                    tryExpandGoalInSelectedProject(nextMilestones, finalGoal)
                }
            } else if (!goalsShowMoreExpanded) {
                tryExpandGoalInSelectedProject(nextMilestones, finalGoal)
            }
        }
    }

    return (
        <CustomScrollView showsVerticalScrollIndicator={false}>
            {showDateRangeModal ? (
                <GoalMilestoneRangeModal
                    projectId={projectId}
                    closeModal={delayClosePopup}
                    updateMilestoneDateRange={saveDateRange}
                    startingMilestoneDate={goal.startingMilestoneDate}
                    completionMilestoneDate={goal.completionMilestoneDate}
                    ownerId={goal.ownerId}
                />
            ) : showAssigneeModal ? (
                <GoalAssigneesModal
                    closeModal={delayClosePopup}
                    updateAssignees={saveAssignee}
                    initialSelectedAssigeesIds={goal.assigneesIds}
                    projectId={projectId}
                    initialSelectedAssigeesCapacity={goal.assigneesCapacity}
                />
            ) : showPrivacyModal ? (
                <PrivacyModal
                    object={goal}
                    objectType={FEED_GOAL_OBJECT_TYPE}
                    projectId={projectId}
                    closePopover={delayClosePopup}
                    delayClosePopover={delayClosePopup}
                    savePrivacyBeforeSaveObject={savePrivacy}
                />
            ) : showDescriptionModal ? (
                <DescriptionModal
                    projectId={projectId}
                    object={goal}
                    closeModal={delayClosePopup}
                    objectType={FEED_GOAL_OBJECT_TYPE}
                    updateDescription={saveDescription}
                />
            ) : showHighlightModal ? (
                <HighlightColorModal
                    onPress={saveHighlight}
                    selectedColor={goal.hasStar}
                    closeModal={delayClosePopup}
                />
            ) : (
                <MainModal
                    projectId={projectId}
                    closeModal={closeModal}
                    goal={goal}
                    showAssigneeModal={showAssigneeModal}
                    showDateRange={showDateRange}
                    showPrivacy={showPrivacy}
                    showAssignees={showAssignees}
                    showDescription={showDescription}
                    showHighlight={showHighlight}
                    createGoal={createGoal}
                    setGoal={setGoal}
                />
            )}
        </CustomScrollView>
    )
}
