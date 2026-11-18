import React from 'react'
import { useSelector } from 'react-redux'

import useGetTaskWorkflow from '../../utils/useGetTaskWorkflow'
import SharedHelper from '../../utils/SharedHelper'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { objectIsLockedForUser } from '../Guides/guidesHelper'
import CommentPopupWorkflowControls, {
    WORKFLOW_CONTROLS_LAYOUT_BAR,
    getCommentPopupWorkflowTargets,
} from '../UIComponents/FloatModals/RichCommentModal/CommentPopupWorkflowControls'

/**
 * Does the chat tab show the workflow bar for this task? Same rule `CommentPopupWorkflowControls`
 * uses to render nothing, so the header can drop the assistant line exactly when the bar takes
 * its place.
 */
export function useTaskChatShowsWorkflowBar(projectId, task) {
    const workflow = useGetTaskWorkflow(projectId, task)
    return !!getCommentPopupWorkflowTargets(task, workflow)
}

export default function TaskChatWorkflowControls({ projectId, task }) {
    const loggedUser = useSelector(state => state.loggedUser)
    const narrow = !!useSelector(state => state.smallScreenNavigation)
    const workflow = useGetTaskWorkflow(projectId, task)
    const accessGranted = SharedHelper.checkIfUserHasAccessToProject(
        loggedUser.isAnonymous,
        loggedUser.projectIds,
        projectId,
        false
    )
    const loggedUserCanUpdateObject =
        loggedUser.uid === task.userId || !ProjectHelper.checkIfLoggedUserIsNormalUserInGuide(projectId)
    const isLocked = objectIsLockedForUser(projectId, loggedUser.unlockedKeysByGuides, task.lockKey, task.userId)

    return (
        <CommentPopupWorkflowControls
            projectId={projectId}
            task={task}
            workflow={workflow}
            disabled={!loggedUserCanUpdateObject || !accessGranted || isLocked}
            appearance="chat"
            // AT-3081 — a slim current-step bar instead of the stacked panel, so the chat keeps
            // its height; the step list opens from the bar, Back/Forward stay on it.
            layout={WORKFLOW_CONTROLS_LAYOUT_BAR}
            narrow={narrow}
        />
    )
}
