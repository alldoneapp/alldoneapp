const admin = require('firebase-admin')

const { updateUserRecord } = require('../AlgoliaGlobalSearchHelper')
const { generateUserWarnings } = require('../Payment/QuotaWarnings')
const { processAutomaticSkillPointDistribution } = require('../Skills/automaticSkillPointDistribution')

const proccessAlgoliaRecord = async (userId, change) => {
    await updateUserRecord(userId, change, admin)
}

const onUpdateUser = async (userId, change) => {
    const oldUser = { ...change.before.data(), uid: userId }
    const newUser = { ...change.after.data(), uid: userId }

    const promises = []
    promises.push(generateUserWarnings(userId, oldUser, newUser, admin))
    promises.push(proccessAlgoliaRecord(userId, change))

    if (Number(newUser.level || 1) > Number(oldUser.level || 1)) {
        promises.push(processAutomaticSkillPointDistribution(userId, oldUser, newUser))
    }

    // Check for WhatsApp phone number update
    if (newUser.phone && newUser.phone !== oldUser.phone) {
        console.log(`User ${userId} updated phone number. Scheduling WhatsApp welcome message.`)
        promises.push(
            admin.firestore().collection('whatsAppNotifications').add({
                userId: userId,
                userPhone: newUser.phone,
                isWelcome: true,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            })
        )
    }

    await Promise.all(promises)
}

module.exports = { onUpdateUser }
