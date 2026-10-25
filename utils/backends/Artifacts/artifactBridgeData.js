import store from '../../../redux/store'
import { getDb, getLoggedUserAccessReaderId } from '../firestore'
import {
    BRIDGE_LIMITS,
    isProjectShared,
    toBridgeGoal,
    toBridgeTask,
} from '../../../functions/Artifacts/artifactDataBridge'

// The answers the app gives a data-bound artifact (functions/Artifacts/artifactDataBridge.js), read
// with the viewer's own client: Firestore's rules decide what the viewer may read, and of that only
// objects the whole project shares are handed on. Every query is one the app already makes, so each
// is backed by an index in firestore.indexes.json:
//   open tasks  readerIds ∋ me, done == false, parentId == null, order by dueDate
//   done tasks  the same per member (userId ==), order by completed, newest first

const DAY_MS = 24 * 60 * 60 * 1000

const sharedDocs = snapshot => snapshot.docs.filter(doc => isProjectShared(doc.data()))

function getProjectMemberIds(projectId) {
    const project = store.getState().loggedUserProjectsMap?.[projectId]
    return Array.isArray(project?.userIds) ? project.userIds : []
}

async function readOpenTasks(db, projectId, reader, { limit }) {
    const snapshot = await db
        .collection(`items/${projectId}/tasks`)
        .where('readerIds', 'array-contains', reader)
        .where('done', '==', false)
        .where('parentId', '==', null)
        .orderBy('dueDate', 'asc')
        .limit(limit)
        .get()
    return sharedDocs(snapshot).map(doc => toBridgeTask(doc.id, doc.data()))
}

async function readDoneTasks(db, projectId, reader, { limit, sinceDays }, now) {
    const since = sinceDays ? now - sinceDays * DAY_MS : null
    const perMember = await Promise.all(
        getProjectMemberIds(projectId).map(memberId => {
            let query = db
                .collection(`items/${projectId}/tasks`)
                .where('readerIds', 'array-contains', reader)
                .where('done', '==', true)
                .where('parentId', '==', null)
                .where('userId', '==', memberId)
            if (since) query = query.where('completed', '>=', since)
            return query.orderBy('completed', 'desc').limit(limit).get()
        })
    )
    return perMember
        .flatMap(snapshot => sharedDocs(snapshot).map(doc => toBridgeTask(doc.id, doc.data())))
        .sort((left, right) => (right.completed || 0) - (left.completed || 0))
        .slice(0, limit)
}

async function readGoals(db, projectId, reader) {
    const snapshot = await db
        .collection(`goals/${projectId}/items`)
        .where('readerIds', 'array-contains', reader)
        .limit(BRIDGE_LIMITS.maxGoals)
        .get()
    return sharedDocs(snapshot).map(doc => toBridgeGoal(doc.id, doc.data()))
}

export async function runBridgeQuery(projectId, request, { now = Date.now() } = {}) {
    const state = store.getState()
    switch (request.name) {
        case 'project': {
            const project = state.loggedUserProjectsMap?.[projectId] || {}
            return { id: projectId, name: project.name || '', color: project.color || null }
        }
        case 'members':
            return (state.projectUsers?.[projectId] || []).map(user => ({
                id: user.uid,
                name: user.displayName || '',
            }))
        case 'tasks': {
            const db = getDb()
            const reader = getLoggedUserAccessReaderId()
            return request.params.status === 'done'
                ? readDoneTasks(db, projectId, reader, request.params, now)
                : readOpenTasks(db, projectId, reader, request.params)
        }
        case 'goals':
            return readGoals(getDb(), projectId, getLoggedUserAccessReaderId())
        default:
            throw new Error(`Unknown query "${request.name}".`)
    }
}
