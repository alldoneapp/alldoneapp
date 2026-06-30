const admin = require('firebase-admin')
const { createUserRecord } = require('../AlgoliaGlobalSearchHelper')
const SendInBlueManager = require('../SendInBlueManager')
const { inProductionEnvironment } = require('../Utils/HelperFunctionsCloud')
const {
    safelySyncHeartbeatSchedules,
    syncHeartbeatSchedulesForUser,
} = require('../Assistant/assistantHeartbeatSchedule')

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
    promises.push(
        safelySyncHeartbeatSchedules(() => syncHeartbeatSchedulesForUser(user.uid), {
            source: 'user_created',
            userId: user.uid,
        })
    )
    await Promise.all(promises)
}

module.exports = { onCreateUser }
