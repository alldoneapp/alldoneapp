const admin = require('firebase-admin')
const { createUserRecord } = require('../AlgoliaGlobalSearchHelper')
const SendInBlueManager = require('../SendInBlueManager')
const { inProductionEnvironment } = require('../Utils/HelperFunctionsCloud')

const onCreateUser = async user => {
    if (!user || typeof user.email !== 'string' || !user.email.trim()) {
        console.warn('Skipping user creation side effects for document without a valid email', {
            userId: user?.uid || null,
        })
        return
    }

    const promises = []
    if (inProductionEnvironment()) promises.push(SendInBlueManager.sendEmailToNewSignUpUser(admin, user))
    promises.push(createUserRecord(user.uid, user))
    await Promise.all(promises)
}

module.exports = { onCreateUser }
