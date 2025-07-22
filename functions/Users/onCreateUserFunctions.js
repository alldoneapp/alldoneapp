const admin = require('firebase-admin')
const { createUserRecord } = require('../AlgoliaGlobalSearchHelper')
const SendInBlueManager = require('../SendInBlueManager')
const { inProductionEnvironment } = require('../Utils/HelperFunctionsCloud')

const onCreateUser = async user => {
    const promises = []
    if (inProductionEnvironment()) promises.push(SendInBlueManager.sendEmailToNewSignUpUser(admin, user))
    promises.push(createUserRecord(user.uid, user))
    await Promise.all(promises)
}

module.exports = { onCreateUser }
