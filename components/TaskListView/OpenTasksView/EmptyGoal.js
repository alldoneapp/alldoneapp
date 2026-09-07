import React, { useRef, useState, useEffect } from 'react'
import { Animated, StyleSheet, View } from 'react-native'
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
import useOptimisticGoalPostponeHidden from '../../GoalsView/useOptimisticGoalPostponeHidden'
import useGoalSectionExitMotion from './goalSectionExitMotion'

export default function EmptyGoal({
    goal,
    projectId,
    isActiveOrganizeMode,
    instanceKey,
    dateIndex,
    containerStyle,
    exitRunId = 0,
}) {
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
    // AT-2160: keep this above the early return — hooks must run on every render.
    const hiddenByOptimisticPostpone = useOptimisticGoalPostponeHidden(projectId, goal?.id)
    /**
     * AT-2521 — the same graceful departure `ParentGoalSection` plays, because this is the row that
     * is actually on screen when a goal leaves today's list: the tasks snapshot lands first and
     * turns the section into this empty row, and only the goal snapshot after it takes the goal out
     * of the day. `exitRunId` is 0 for every ordinary empty goal, so an ordinary row carries no
     * animated wrapper at all. `MainSection` decides WHETHER the goal is leaving and keeps it
     * mounted for the run; this only draws it.
     */
    const { onSectionLayout, sectionStyle } = useGoalSectionExitMotion(exitRunId)

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

    // AT-2160: the goal is on its way out of today — drop it now instead of after the round trip.
    if (hiddenByOptimisticPostpone) return null

    return (
        <Animated.View
            onLayout={onSectionLayout}
            style={[
                localStyles.container,
                containerStyle,
                isLocked &&
                    showingTasks &&
                    !isAnonymous && { minHeight: (smallScreenNavigation ? 332 : 258) + (editing ? 168 : 86) },
                // Last, so the pinned height wins over the locked-goal `minHeight` above it — a
                // floor left in place would stop the collapse dead at 258px.
                sectionStyle,
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
        </Animated.View>
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
