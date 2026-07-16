export const MERGE_STATUS_LABELS = {
    draft: 'Draft',
    checks_running: 'Checks running',
    needs_approval: 'Needs approval',
    blocked: 'Blocked',
    ready_to_merge: 'Ready to merge',
    merged: 'Merged',
    closed: 'Closed',
}

export const getMergeStatusLabel = status => MERGE_STATUS_LABELS[status] || null

export const getTaskMergeRequest = task => task?.vmMergeRequest || null
