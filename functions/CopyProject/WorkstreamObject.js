const { DEFAULT_WORKSTREAM_ID } = require('../Workstreams/WorkstreamHelper')
const { promiseAllAndCatch } = require('./HelperFunctions')

const copyWorkstream = async (firebase, projectId, newProjectId, user, originStreams) => {
    const db = firebase.firestore()
    let arrayPromises = []
    let promiseIndex = 0

    originStreams.forEach(stream => {
        const newStreamRef = db.doc(`/projectsWorkstreams/${newProjectId}/workstreams/${stream.id}`)
        const newStreamData = {
            ...stream.data(),
            projectId: newProjectId,
            lastVisitBoard: {},
            lastVisitBoardInGoals: {},
            userIds: [],
            created: Date.now(),
            creatorId: user.uid,
            lastEditionDate: Date.now(),
            lastEditorId: user.uid,
            photoURL: DEFAULT_WORKSTREAM_ID,
        }

        if (!arrayPromises[promiseIndex]) arrayPromises[promiseIndex] = []
        arrayPromises[promiseIndex].push(newStreamRef.set(newStreamData))

        if (arrayPromises[promiseIndex].length === 500) {
            promiseIndex++
        }
    })

    for (let subArray of arrayPromises) {
        await promiseAllAndCatch(subArray, 'WORKSTREAMS')
    }

    return true
}

module.exports = {
    copyWorkstream,
}
