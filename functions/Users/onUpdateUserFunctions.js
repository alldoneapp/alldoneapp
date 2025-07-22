const admin = require('firebase-admin')
const { intersection } = require('lodash')

const { updateUserRecord } = require('../AlgoliaGlobalSearchHelper')
const { generateUserWarnings } = require('../Payment/QuotaWarnings')
const { updateProjectLastUserInteractionDate } = require('../Projects/projectsFirestore')

const proccessAlgoliaRecord = async (userId, change) => {
    await updateUserRecord(userId, change, admin)
}

const updateProjectsLastUserInteractionDate = async (oldProjectIds, newProjectIds) => {
    const projectIds = intersection(oldProjectIds, newProjectIds)
    const promises = []
    const date = Date.now()
    projectIds.forEach(projectId => {
        promises.push(updateProjectLastUserInteractionDate(projectId, date))
    })
    await Promise.all(promises)
}

const onUpdateUser = async (userId, change) => {
    const oldUser = { ...change.before.data(), uid: userId }
    const newUser = { ...change.after.data(), uid: userId }

    const promises = []
    promises.push(generateUserWarnings(userId, oldUser, newUser, admin))
    promises.push(proccessAlgoliaRecord(userId, change))
    promises.push(updateProjectsLastUserInteractionDate(oldUser.projectIds, newUser.projectIds))
    await Promise.all(promises)
}

module.exports = { onUpdateUser }
