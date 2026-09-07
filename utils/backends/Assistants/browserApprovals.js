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
 * Query shape: three equality filters, which Firestore serves without a composite index.
 */
export function watchBrowserApprovals(projectId, objectId, userId, callback) {
    if (!projectId || !objectId || !userId) return () => {}

    return getDb()
        .collection('browserApprovals')
        .where('requestUserId', '==', userId)
        .where('projectId', '==', projectId)
        .where('objectId', '==', objectId)
        .where('status', '==', 'pending')
        .onSnapshot(
            snapshot => {
                const now = Date.now()
                const approvals = []
                snapshot.forEach(doc => {
                    const approval = doc.data()
                    // An expired request is answered with an error by the callable anyway; hiding it
                    // here keeps a dead card from sitting in the thread.
                    if (Number(approval?.expiresAt) && Number(approval.expiresAt) <= now) return
                    approvals.push({ ...approval, approvalId: approval.approvalId || doc.id })
                })
                callback(approvals)
            },
            error => {
                // Never throws into the render: a thread that cannot read its approvals still has to
                // show the conversation.
                console.warn('watchBrowserApprovals failed', error?.message)
                callback([])
            }
        )
}

export function respondToBrowserApproval({ approvalId, action, scope }) {
    return runHttpsCallableFunction('respondToBrowserApprovalSecondGen', { approvalId, action, scope })
}

export function listBrowserApprovalRequests({ projectId } = {}) {
    return runHttpsCallableFunction('listBrowserApprovalRequestsSecondGen', { projectId: projectId || null })
}
