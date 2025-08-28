const admin = require('firebase-admin')

const { updateRecord, GOALS_OBJECTS_TYPE } = require('../AlgoliaGlobalSearchHelper')
const { checkIfObjectIsLocked } = require('../Utils/HelperFunctionsCloud')

const proccessAlgoliaRecord = async (projectId, goalId, oldGoal, newGoal) => {
    const isLocked = await checkIfObjectIsLocked(projectId, newGoal.lockKey, newGoal.ownerId)
    if (!isLocked) {
        await updateRecord(projectId, goalId, oldGoal, newGoal, GOALS_OBJECTS_TYPE, admin.firestore())
    }
}

const onUpdateGoal = async (projectId, goalId, change) => {
    const oldGoal = change.before.data()
    const newGoal = change.after.data()

    await proccessAlgoliaRecord(projectId, goalId, oldGoal, newGoal)
}

module.exports = {
    onUpdateGoal,
}
