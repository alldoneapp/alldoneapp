import React from 'react'
import { useSelector } from 'react-redux'

import useGetTaskWorkflow from '../../utils/useGetTaskWorkflow'
import SharedHelper from '../../utils/SharedHelper'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { objectIsLockedForUser } from '../Guides/guidesHelper'
import CommentPopupWorkflowControls from '../UIComponents/FloatModals/RichCommentModal/CommentPopupWorkflowControls'

export default function TaskChatWorkflowControls({ projectId, task }) {
    const loggedUser = useSelector(state => state.loggedUser)
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
        />
    )
}
