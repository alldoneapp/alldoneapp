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
                    right: 24 + safeAreaInsets.right,
                    bottom: 24 + safeAreaInsets.bottom,
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
        position: 'fixed',
        zIndex: 9000,
        borderRadius: 28,
        boxShadow: '0 4px 14px rgba(0, 0, 0, 0.24)',
    },
    button: {
        width: 56,
        height: 56,
        borderRadius: 28,
        paddingHorizontal: 0,
        backgroundColor: colors.Primary100,
        borderColor: colors.Primary100,
    },
})
