import { getUserPresentationData } from '../../ContactsView/Utils/ContactsHelper'

// The avatar shown on a pending task's estimation tag is the reviewer of the step the task is
// currently sitting on. That reviewer is not necessarily a project user: a step can point at an
// assistant (see components/WorkflowView/workflowStepHelper.js), and the step itself can be gone
// from the workflow while tasks still reference its id. getUserPresentationData resolves users and
// assistants alike and degrades to an unknown-user avatar, so it is the only safe lookup here — a
// users-only lookup returns null for an assistant step and crashes the whole task list.
export const getWorkflowStepReviewerPhotoURL = (taskOwner, projectId, stepId) => {
    const reviewerUid = taskOwner?.workflow?.[projectId]?.[stepId]?.reviewerUid || ''
    return reviewerUid ? getUserPresentationData(reviewerUid).photoURL : undefined
}
