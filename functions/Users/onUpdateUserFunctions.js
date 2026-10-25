const admin = require('firebase-admin')
const { isEqual } = require('lodash')

const { updateUserRecord } = require('../AlgoliaGlobalSearchHelper')
const { generateUserWarnings } = require('../Payment/QuotaWarnings')
const { processAutomaticSkillPointDistribution } = require('../Skills/automaticSkillPointDistribution')
const {
    ACTIVE_USER_WINDOW_MS,
    getTimestampMillis,
    safelySyncHeartbeatSchedules,
    syncHeartbeatSchedulesForUser,
} = require('../Assistant/assistantHeartbeatSchedule')
const { FieldValue } = require('firebase-admin/firestore')

const HEARTBEAT_USER_SCHEDULE_FIELDS = [
    'timezone',
    'timezoneOffset',
    'timezoneMinutes',
    'preferredTimezone',
    'defaultProjectId',
]

function heartbeatUserScheduleChanged(oldUser, newUser, now = Date.now()) {
    if (HEARTBEAT_USER_SCHEDULE_FIELDS.some(field => oldUser?.[field] !== newUser?.[field])) return true
    const cutoff = now - ACTIVE_USER_WINDOW_MS
    return getTimestampMillis(oldUser?.lastLogin) < cutoff && getTimestampMillis(newUser?.lastLogin) >= cutoff
}

// The only user fields the search index stores (see mapUserData in ParsingTextHelper.js plus the
// per-project role/company/description merged from the project document). Every other write to
// the user document — lastLogin, gold, xp, statistics, settings — used to re-send the full record
// once per project the user belongs to (78 for the main account): 37k user updates a month
// became 56 GB of egress to the search index for records that had not changed.
const SEARCH_INDEXED_USER_FIELDS = [
    'displayName',
    'photoURL',
    'extendedDescription',
    'description',
    'isPrivate',
    'isPublicFor',
    'projectIds',
    'lastEditionDate',
    'company',
    'role',
]

const searchIndexedFieldsChanged = (oldUser, newUser) =>
    SEARCH_INDEXED_USER_FIELDS.some(field => !isEqual(oldUser?.[field], newUser?.[field]))

const proccessAlgoliaRecord = async (userId, change) => {
    await updateUserRecord(userId, change, admin)
}

const onUpdateUser = async (userId, change) => {
    const oldUser = { ...change.before.data(), uid: userId }
    const newUser = { ...change.after.data(), uid: userId }

    const promises = []
    promises.push(generateUserWarnings(userId, oldUser, newUser, admin))
    if (searchIndexedFieldsChanged(oldUser, newUser)) promises.push(proccessAlgoliaRecord(userId, change))

    if (Number(newUser.level || 1) > Number(oldUser.level || 1)) {
        promises.push(processAutomaticSkillPointDistribution(userId, oldUser, newUser))
    }

    if (heartbeatUserScheduleChanged(oldUser, newUser)) {
        promises.push(
            safelySyncHeartbeatSchedules(() => syncHeartbeatSchedulesForUser(userId), {
                source: 'user_updated',
                userId,
            })
        )
    }

    // Check for WhatsApp phone number update
    if (newUser.phone && newUser.phone !== oldUser.phone) {
        console.log(`User ${userId} updated phone number. Scheduling WhatsApp welcome message.`)
        promises.push(
            admin.firestore().collection('whatsAppNotifications').add({
                userId: userId,
                userPhone: newUser.phone,
                isWelcome: true,
                timestamp: FieldValue.serverTimestamp(),
            })
        )
    }

    await Promise.all(promises)
}

module.exports = { onUpdateUser, heartbeatUserScheduleChanged, searchIndexedFieldsChanged, SEARCH_INDEXED_USER_FIELDS }
