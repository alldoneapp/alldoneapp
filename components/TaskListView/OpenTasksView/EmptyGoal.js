import React, { useRef, useState, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'
import { shallowEqual, useSelector } from 'react-redux'

import GoalItem from '../../GoalsView/GoalItem'
import NewTaskSection from './NewTaskSection'
import SortModeActiveInfo from '../../GoalsView/SortModeActiveInfo'
import SharedHelper from '../../../utils/SharedHelper'
import store from '../../../redux/store'
import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import { objectIsLockedForUser } from '../../Guides/guidesHelper'
import LockedGoalModal from '../../UIComponents/FloatModals/LockedGoalModal/LockedGoalModal'
import GoalIndicator from '../GoalIndicator'

export default function EmptyGoal({ goal, projectId, isActiveOrganizeMode, instanceKey, dateIndex, containerStyle }) {
    const isAnonymous = useSelector(state => state.loggedUser.isAnonymous)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const currentUserId = useSelector(state => state.currentUser.uid)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const projectIds = useSelector(state => state.loggedUser.projectIds, shallowEqual)
    const unlockedKeysByGuides = useSelector(state => state.loggedUser.unlockedKeysByGuides)
    const [editing, setEditing] = useState(false)
    const [showingTasks, setShowingTasks] = useState(true)
    const dismissibleRef = useRef(null)

    const accessGranted = SharedHelper.checkIfUserHasAccessToProject(isAnonymous, projectIds, projectId, false)

    const setDismissibleRefs = ref => {
        dismissibleRef.current = ref
    }

    const openEdition = () => {
        const { activeEditMode } = store.getState()
        if (!activeEditMode) {
            dismissibleRef.current.toggleModal()
        }
    }

    const closeEdition = (refKey, forceAction) => {
        dismissibleRef.current.closeModal(false, forceAction)
    }

    const loggedUserIsGoalOwner = loggedUserId === goal.ownerId
    const loggedUserCanUpdateObject =
        loggedUserIsGoalOwner || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)

    const isLocked = objectIsLockedForUser(
        projectId,
        unlockedKeysByGuides,
        goal ? goal.lockKey : '',
        goal ? goal.ownerId : ''
    )

    useEffect(() => {
        if (isActiveOrganizeMode) setShowingTasks(true)
    }, [isActiveOrganizeMode])

    const toggleTasksList = () => {
        setShowingTasks(state => !state)
    }

    return (
        <View
            style={[
                localStyles.container,
                containerStyle,
                isLocked &&
                    showingTasks &&
                    !isAnonymous && { minHeight: (smallScreenNavigation ? 332 : 258) + (editing ? 168 : 86) },
            ]}
        >
            {!isMiddleScreen && !smallScreenNavigation && (
                <GoalIndicator
                    inEditMode={editing}
                    dismissibleRef={dismissibleRef.current}
                    toggleTasksList={toggleTasksList}
                    showingTasks={showingTasks}
                />
            )}
            {goal && (
                <GoalItem
                    goal={goal}
                    projectId={projectId}
                    setDismissibleRefs={setDismissibleRefs}
                    openEdition={openEdition}
                    closeEdition={closeEdition}
                    isActiveOrganizeModeInTasks={isActiveOrganizeMode}
                    isEmptyGoal={true}
                    refKey={goal.id}
                    setEditing={setEditing}
                    showingTasks={showingTasks}
                    toggleTasksList={toggleTasksList}
                />
            )}
            {showingTasks && (
                <View style={isLocked && localStyles.blurry} pointerEvents={isLocked ? 'none' : 'auto'}>
                    {accessGranted &&
                        loggedUserCanUpdateObject &&
                        (isActiveOrganizeMode ? (
                            <SortModeActiveInfo containerStyle={{ paddingLeft: 8 }} />
                        ) : (
                            <NewTaskSection
                                projectId={projectId}
                                originalParentGoal={goal}
                                instanceKey={instanceKey}
                                dateIndex={dateIndex}
                                isLocked={isLocked}
                            />
                        ))}
                </View>
            )}
            {isLocked && !isAnonymous && showingTasks ? (
                <LockedGoalModal
                    projectId={projectId}
                    lockKey={goal.lockKey}
                    editing={editing}
                    goalId={goal.id}
                    ownerId={goal.ownerId}
                    tasks={[]}
                    date={goal.assigneesReminderDate[currentUserId]}
                />
            ) : null}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
    },
    blurry: {
        filter: 'blur(3px)',
        userSelect: 'none',
    },
})
