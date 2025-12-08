const admin = require('firebase-admin')

const { updateUserRecord } = require('../AlgoliaGlobalSearchHelper')
const { generateUserWarnings } = require('../Payment/QuotaWarnings')

const proccessAlgoliaRecord = async (userId, change) => {
    await updateUserRecord(userId, change, admin)
}

const onUpdateUser = async (userId, change) => {
    const oldUser = { ...change.before.data(), uid: userId }
    const newUser = { ...change.after.data(), uid: userId }

    const promises = []
    promises.push(generateUserWarnings(userId, oldUser, newUser, admin))
    promises.push(proccessAlgoliaRecord(userId, change))

    // Check for WhatsApp phone number update
    if (newUser.phone && newUser.phone !== oldUser.phone) {
        console.log(`User ${userId} updated phone number. Scheduling WhatsApp welcome message.`)
        promises.push(
            admin.firestore().collection('whatsAppNotifications').add({
                userId: userId,
                userPhone: newUser.phone,
                projectId: 'private',
                projectName: 'Private',
                objectName: 'Welcome',
                updateText: 'Hi - here is Anna Alldone. What can I do for you?',
                link: 'https://my.alldone.app',
                assistantName: 'Anna Alldone',
                openTasksCount: 1,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            })
        )
    }

    await Promise.all(promises)
}

module.exports = { onUpdateUser }
