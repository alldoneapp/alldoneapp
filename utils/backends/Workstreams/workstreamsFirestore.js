import { firebase } from '@firebase/app'

import { DEFAULT_WORKSTREAM_ID, WORKSTREAM_ID_PREFIX } from '../../../components/Workstreams/WorkstreamHelper'
import { BatchWrapper } from '../../../functions/BatchWrapper/batchWrapper'
import { getDb, mapWorkstreamData, getId, logEvent, runHttpsCallableFunction, globalWatcherUnsub } from '../firestore'
import store from '../../../redux/store'
import TasksHelper from '../../../components/TaskListView/Utils/TasksHelper'
import { addWorkstreamToUser, removeWorkstreamFromUser } from '../Users/usersFirestore'

//ACCESS FUNCTIONS

export async function watchProjectWorkstreams(projectId, callback, watcherKey) {
    globalWatcherUnsub[watcherKey] = getDb()
        .collection(`projectsWorkstreams/${projectId}/workstreams`)
        .onSnapshot(async docs => {
            const workstreams = []
            docs.forEach(doc => {
                workstreams.push(mapWorkstreamData(doc.id, doc.data()))
            })

            callback(workstreams)
        })
}

export async function getWorkstreamData(projectId, workstreamId) {
    const workstream = (await getDb().doc(`/projectsWorkstreams/${projectId}/workstreams/${workstreamId}`).get()).data()
    return workstream ? mapWorkstreamData(workstreamId, workstream) : null
}

export async function getProjectWorkstreams(projectId) {
    const wsDocs = await getDb().collection(`projectsWorkstreams/${projectId}/workstreams`).get()

    const workstreams = []
    wsDocs.forEach(doc => {
        const workstream = mapWorkstreamData(doc.id, doc.data())
        workstreams.push(workstream)
    })

    return workstreams
}

export const getUserWorkstreams = async (projectId, userId) => {
    const wsDocs = await getDb()
        .collection(`projectsWorkstreams/${projectId}/workstreams`)
        .where('userIds', 'array-contains-any', [userId])
        .get()

    const workstreams = []
    wsDocs.forEach(doc => {
        workstreams.push(mapWorkstreamData(doc.id, doc.data()))
    })
    return workstreams
}

//EDTION AND ADITION FUNCTIONS

const updateEditionData = data => {
    const { loggedUser } = store.getState()
    data.lastEditionDate = Date.now()
    data.lastEditorId = loggedUser.uid
}

async function updateWorkstreamData(projectId, workstreamId, data, batch) {
    updateEditionData(data)
    const ref = getDb().doc(`projectsWorkstreams/${projectId}/workstreams/${workstreamId}`)
    batch ? batch.update(ref, data) : await ref.update(data)
}

export async function uploadNewMainWorkstream(projectId, workstream, batch) {
    logEvent('new_workstream', {
        id: DEFAULT_WORKSTREAM_ID,
        projectId: projectId,
        initialMembers: workstream.userIds,
    })

    batch.set(getDb().doc(`projectsWorkstreams/${projectId}/workstreams/${DEFAULT_WORKSTREAM_ID}`), workstream)
}

export async function uploadNewWorkstream(projectId, workstream) {
    updateEditionData(workstream)

    const workstreamId = `${WORKSTREAM_ID_PREFIX}${getId()}`

    const batch = new BatchWrapper(getDb())
    batch.set(getDb().doc(`projectsWorkstreams/${projectId}/workstreams/${workstreamId}`), workstream)
    batch.update(getDb().doc(`projects/${projectId}`), {
        workstreamIds: firebase.firestore.FieldValue.arrayUnion(workstreamId),
    })

    for (let userId of workstream.userIds) {
        addWorkstreamToUser(projectId, userId, workstreamId, batch)
    }

    logEvent('new_workstream', {
        id: workstreamId,
        projectId,
        initialMembers: workstream.userIds,
    })

    await batch.commit()
}

export async function deleteWorkstream(projectId, stream) {
    const workstreamId = stream.uid
    const batch = new BatchWrapper(getDb())
    batch.delete(getDb().doc(`/projectsWorkstreams/${projectId}/workstreams/${workstreamId}`))
    batch.update(getDb().doc(`/projects/${projectId}`), {
        workstreamIds: firebase.firestore.FieldValue.arrayRemove(workstreamId),
    })

    for (let userId of stream.userIds) {
        removeWorkstreamFromUser(projectId, userId, workstreamId, batch)
    }

    await runHttpsCallableFunction('onRemoveWorkstreamSecondGen', { projectId, streamId: workstreamId })

    batch.commit()
}

export async function updateWorkstream(projectId, stream, oldStream) {
    const batch = new BatchWrapper(getDb())

    updateWorkstreamData(projectId, stream.uid, stream, batch)

    for (let userId of stream.userIds) {
        addWorkstreamToUser(projectId, userId, stream.uid, batch)
    }

    for (let userId of oldStream.userIds) {
        if (!stream.userIds.includes(userId)) {
            removeWorkstreamFromUser(projectId, userId, stream.uid, batch)
        }
    }

    batch.commit()
}

export async function setWorkstreamDescription(projectId, workstreamId, description, oldDescription) {
    const cleanedDescription = TasksHelper.getTaskNameWithoutMeta(description)
    const batch = new BatchWrapper(getDb())

    updateWorkstreamData(projectId, workstreamId, { description: cleanedDescription }, batch)

    batch.commit()
}

export async function addWorkstreamMember(projectId, workstreamId, userId, batch) {
    updateWorkstreamData(projectId, workstreamId, { userIds: firebase.firestore.FieldValue.arrayUnion(userId) }, batch)
}

export async function removeWorkstreamMember(projectId, workstreamId, userId, batch) {
    updateWorkstreamData(projectId, workstreamId, { userIds: firebase.firestore.FieldValue.arrayRemove(userId) }, batch)
}

export async function setWorkstreamMembers(projectId, workstreamId, members, oldMembers) {
    const batch = new BatchWrapper(getDb())

    updateWorkstreamData(projectId, workstreamId, { userIds: members }, batch)

    for (let userId of members) {
        addWorkstreamToUser(projectId, userId, workstreamId, batch)
    }

    for (let userId of oldMembers) {
        if (!members.includes(userId)) {
            removeWorkstreamFromUser(projectId, userId, workstreamId, batch)
        }
    }

    batch.commit()
}

export function updateWorkstreamLastVisitedBoardDate(
    projectId,
    workstreamId,
    lastVisitBoardProperty,
    date = Date.now()
) {
    const { loggedUser } = store.getState()
    updateWorkstreamData(
        projectId,
        workstreamId,
        { [`${lastVisitBoardProperty}.${projectId}.${loggedUser.uid}`]: date },
        null
    )
}
