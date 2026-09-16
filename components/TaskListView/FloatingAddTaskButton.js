import React, { useCallback } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import { clearPendingWebShareTarget, setTasksArrowButtonIsExpanded } from '../../redux/actions'
import { clearStoredWebShareTarget } from '../../utils/webShareTarget'
import SharedHelper from '../../utils/SharedHelper'
import useModalSizing from '../../hooks/useModalSizing'
import { useVoiceCall } from '../UIComponents/AssistantVoiceCallProvider'
import { AUTOMATIC_PROJECT_OPTION } from '../UIComponents/FloatModals/SelectProjectModal/projectPickerConstants'
import { FEED_TASK_OBJECT_TYPE } from '../Feeds/Utils/FeedsConstants'
import ProjectHelper, {
    checkIfSelectedAllProjects,
    checkIfSelectedProject,
} from '../SettingsView/ProjectsSettings/ProjectHelper'
import AddTaskTag from '../Tags/AddTaskTag'
import { colors } from '../styles/global'
import {
    FLOATING_ACTION_SIZE,
    FLOATING_ACTION_VIEWPORT_GAP,
    getFloatingActionBottom,
} from '../UIComponents/floatingActionLayout'

/**
 * AT-2575 — the task board owns one add-task action, independent of the active
 * board tab and of whichever project lines happen to be rendered in it.
 */
export default function FloatingAddTaskButton() {
    const dispatch = useDispatch()
    const voiceCall = useVoiceCall()
    const { safeAreaInsets } = useModalSizing()
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const selectedProject = useSelector(state => state.loggedUserProjects[selectedProjectIndex])
    const loggedUser = useSelector(state => state.loggedUser)
    const currentUser = useSelector(state => state.currentUser)
    const pendingWebShareTarget = useSelector(state => state.pendingWebShareTarget)

    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)
    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)
    const projectId = inAllProjects ? AUTOMATIC_PROJECT_OPTION : selectedProject?.id
    const loggedUserCanUpdateProject =
        inSelectedProject &&
        (loggedUser?.uid === currentUser?.uid || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)) &&
        SharedHelper.accessGranted(loggedUser, projectId)
    const canAddTask =
        voiceCall?.status === 'idle' &&
        !!projectId &&
        !currentUser?.temperature &&
        (inAllProjects || loggedUserCanUpdateProject)

    const consumeWebShareTarget = useCallback(() => {
        clearStoredWebShareTarget()
        dispatch(clearPendingWebShareTarget())
    }, [dispatch])
    const expandSelectedProjectTaskList = useCallback(() => {
        dispatch(setTasksArrowButtonIsExpanded(true))
    }, [dispatch])

    if (!canAddTask) return null

    return (
        <View
            testID="floating-add-task-button"
            style={[
                localStyles.floating,
                {
                    right: FLOATING_ACTION_VIEWPORT_GAP + safeAreaInsets.right,
                    bottom: getFloatingActionBottom(safeAreaInsets.bottom),
                },
            ]}
        >
            <AddTaskTag
                projectId={projectId}
                sourceType={FEED_TASK_OBJECT_TYPE}
                expandTaskListIfNeeded={true}
                setPressedShowMoreMainSection={inSelectedProject ? expandSelectedProjectTaskList : undefined}
                showProjectSelector={inAllProjects ? true : undefined}
                primary={true}
                forceShrink={true}
                headerAction={true}
                iconSize={24}
                floating={true}
                style={localStyles.button}
                initialTaskName={pendingWebShareTarget?.taskName}
                autoOpenKey={pendingWebShareTarget?.id}
                onAutoOpen={consumeWebShareTarget}
            />
        </View>
    )
}

const localStyles = StyleSheet.create({
    floating: {
        // MainViewsContainer renders this through CustomScrollView.fixedChildren,
        // outside the scrolling content. Absolute positioning therefore pins it
        // to the visible task viewport without relying on fixed descendants of a
        // browser scroller.
        position: 'absolute',
        zIndex: 9000,
        borderRadius: FLOATING_ACTION_SIZE / 2,
    },
    button: {
        width: FLOATING_ACTION_SIZE,
        height: FLOATING_ACTION_SIZE,
        borderRadius: FLOATING_ACTION_SIZE / 2,
        paddingHorizontal: 0,
        backgroundColor: colors.Primary100,
        borderColor: colors.Primary100,
        boxShadow: '0px 6px 16px rgba(4,20,47,0.24)',
    },
})
