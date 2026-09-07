import { getDb, runHttpsCallableFunction } from '../firestore'

/**
 * The client half of the browser tool's approval gate.
 *
 * Reading and answering are deliberately asymmetric. The pending request is READ over a live
 * Firestore listener, because the card has to appear the moment the assistant stops and asks, and
 * because the request is created by a Cloud Function the client has no other way to learn about.
 * The ANSWER goes through a callable — `browserApprovals` is server-write-only, so the grant can
 * only ever be minted by `respondToBrowserApproval`, which checks that the person answering is the
 * person the request was raised for and that the requested scope is one the policy allows.
 *
 * Query shape: equality filters only, which Firestore serves without a composite index. Pending
 * and in-progress are two small listeners so completed approval history is never loaded merely to
 * keep a secure login visible after a page refresh.
 */
export function watchBrowserApprovals(projectId, objectId, userId, callback) {
    if (!projectId || !objectId || !userId) return () => {}

    const byStatus = { pending: [], in_progress: [] }
    const emit = () => callback([...byStatus.pending, ...byStatus.in_progress])
    const subscribe = status =>
        getDb()
            .collection('browserApprovals')
            .where('requestUserId', '==', userId)
            .where('projectId', '==', projectId)
            .where('objectId', '==', objectId)
            .where('status', '==', status)
            .onSnapshot(
                snapshot => {
                    const now = Date.now()
                    const approvals = []
                    snapshot.forEach(doc => {
                        const approval = doc.data()
                        // An expired request is answered with an error by the callable anyway;
                        // hiding it here keeps a dead card from sitting in the thread.
                        if (Number(approval?.expiresAt) && Number(approval.expiresAt) <= now) return
                        approvals.push({ ...approval, approvalId: approval.approvalId || doc.id })
                    })
                    byStatus[status] = approvals
                    emit()
                },
                error => {
                    // Never throws into the render: a thread that cannot read its approvals still
                    // has to show the conversation.
                    console.warn('watchBrowserApprovals failed', error?.message)
                    byStatus[status] = []
                    emit()
                }
            )

    const unsubscribes = [subscribe('pending'), subscribe('in_progress')]
    return () => unsubscribes.forEach(unsubscribe => unsubscribe())
}

export function respondToBrowserApproval({ approvalId, action, scope }) {
    return runHttpsCallableFunction('respondToBrowserApprovalSecondGen', { approvalId, action, scope })
}

export function listBrowserApprovalRequests({ projectId } = {}) {
    return runHttpsCallableFunction('listBrowserApprovalRequestsSecondGen', { projectId: projectId || null })
}
