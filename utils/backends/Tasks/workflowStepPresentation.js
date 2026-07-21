import { translate } from '../../../i18n/TranslationService'

// A task stores step ids in `stepHistory` / `currentReviewerId`, but the steps themselves live on
// the reviewer's user doc (users/{uid}.workflow[projectId]). Deleting a step from the workflow does
// not rewrite the tasks that still reference it, so a lookup by step id can miss. Feeds are activity
// history: a missing step has to degrade to a readable label rather than abort the batch recording
// the task move — the same reason getStepWorkflowDirection in ./workflowDirection falls back to a
// default direction instead of throwing.
//
// Firestore rejects `undefined` field values, so both fields need a concrete fallback: an unset
// `description` or `reviewerUid` would fail the whole feed write, not just render blank.
//
// 'Unknown step' mirrors how getUserPresentationData degrades to 'Unknown user' — the client cannot
// tell a deleted step apart from one it simply cannot see, so both read as unknown.
export const getWorkflowStepPresentation = (workflow, stepId) => {
    const step = (workflow && workflow[stepId]) || {}
    return {
        description: step.description || translate('Unknown step'),
        reviewerUid: step.reviewerUid || '',
    }
}
