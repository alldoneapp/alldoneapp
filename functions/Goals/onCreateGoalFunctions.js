const admin = require('firebase-admin')

const { createRecord, GOALS_OBJECTS_TYPE } = require('../AlgoliaGlobalSearchHelper')
const { checkIfObjectIsLocked } = require('../Utils/HelperFunctionsCloud')

const proccessAlgoliaRecord = async (projectId, goal) => {
    const isLocked = await checkIfObjectIsLocked(projectId, goal.lockKey, goal.ownerId)
    if (!isLocked) {
        await createRecord(projectId, goal.id, goal, GOALS_OBJECTS_TYPE, admin.firestore(), false, null)
    }
}

const onCreateGoal = async (projectId, goal) => {
    await proccessAlgoliaRecord(projectId, goal)
}

module.exports = {
    onCreateGoal,
}
