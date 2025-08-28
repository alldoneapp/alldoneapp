import React from 'react'
import { isEmpty } from 'lodash'
import { useSelector } from 'react-redux'

import FollowUpModal from '../../../../FollowUp/FollowUpModal'
import WorkflowModal from '../../../../WorkflowModal/WorkflowModal'
import { MENTION_MODAL_ID } from '../../../../ModalsManager/modalsManager'
import SuggestedModal from '../../../../Suggeted/SuggestedModal'
import WorkflowObserverModal from '../../../../UIComponents/FloatModals/WorkflowObserverModal/WorkflowObserverModal'
import { WORKSTREAM_ID_PREFIX } from '../../../../Workstreams/WorkstreamHelper'
import TasksHelper from '../../../Utils/TasksHelper'

export default function TaskFlowModal({
    task,
    projectId,
    isObservedTask,
    isToReviewTask,
    isSuggested,
    pending,
    cancelPopover,
    checkBoxIdRef,
    setVisiblePopover,
}) {
    const loggedUser = useSelector(state => state.loggedUser)
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const openModals = useSelector(state => state.openModals)

    const hidePopover = () => {
        if (!isQuillTagEditorOpen && !openModals[MENTION_MODAL_ID]) {
            setVisiblePopover(false)
            isChecked = false
        }
    }

    const ownerIsWorkstream = task.userId.startsWith(WORKSTREAM_ID_PREFIX)
    const taskOwner = ownerIsWorkstream ? loggedUser : TasksHelper.getTaskOwner(task.userId, projectId)
    const isNonTeamMember = !!taskOwner.recorderUserId

    const showWorkflowPopup =
        !task.isPrivate &&
        taskOwner.workflow &&
        taskOwner.workflow[projectId] &&
        !isEmpty(taskOwner.workflow[projectId])

    return isObservedTask && !isToReviewTask ? (
        <WorkflowObserverModal
            workflow={taskOwner.workflow && taskOwner.workflow[projectId] ? taskOwner.workflow[projectId] : {}}
            projectId={projectId}
            task={task}
            hidePopover={hidePopover}
            cancelPopover={cancelPopover}
            pending={pending}
            ownerIsWorkstream={ownerIsWorkstream}
            checkBoxId={checkBoxIdRef.current}
            isNonTeamMember={isNonTeamMember}
        />
    ) : isSuggested ? (
        <SuggestedModal
            task={task}
            projectId={projectId}
            hidePopover={hidePopover}
            cancelPopover={cancelPopover}
            checkBoxId={checkBoxIdRef.current}
        />
    ) : showWorkflowPopup ? (
        <WorkflowModal
            workflow={taskOwner.workflow[projectId]}
            projectId={projectId}
            task={task}
            hidePopover={hidePopover}
            cancelPopover={cancelPopover}
            pending={pending}
            ownerIsWorkstream={ownerIsWorkstream}
            checkBoxId={checkBoxIdRef.current}
        />
    ) : (
        <FollowUpModal
            task={task}
            projectId={projectId}
            hidePopover={hidePopover}
            cancelPopover={cancelPopover}
            checkBoxId={checkBoxIdRef.current}
        />
    )
}
