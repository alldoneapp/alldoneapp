'use strict'

// When a wiki runs: in the night of the member who pays for it, and only while that member is
// active. "Active" is the heartbeat definition (a login within ACTIVE_USER_WINDOW_MS, 30 days),
// imported rather than re-declared so it cannot drift from what heartbeats, the scheduled calendar
// pull and the broken-connection notices mean by it.
//
// Kept apart from knowledgeBaseIngest.js because the run and the default switch-on
// (knowledgeBaseDefaults.js) both need these, and the run itself is far too heavy to load from a
// user or project trigger.

const { ACTIVE_USER_WINDOW_MS, getTimestampMillis } = require('../Assistant/assistantHeartbeatSchedule')
const { getUserLocalDayStart } = require('../GoogleCalendar/calendarUserDay')

const NIGHTLY_HOUR = 3

// The next 03:00 in the owner's own day, so a wiki is rebuilt while its project sleeps.
function nextNightlyRunAt(now, ownerData = {}) {
    const dayStart = getUserLocalDayStart(ownerData, now)
    const tonight = dayStart.clone().add(NIGHTLY_HOUR, 'hours').valueOf()
    return tonight > now ? tonight : dayStart.clone().add(1, 'day').add(NIGHTLY_HOUR, 'hours').valueOf()
}

function isKnowledgeBaseOwnerActive(userData, now = Date.now()) {
    return !!userData && getTimestampMillis(userData.lastLogin) >= now - ACTIVE_USER_WINDOW_MS
}

module.exports = {
    NIGHTLY_HOUR,
    nextNightlyRunAt,
    isKnowledgeBaseOwnerActive,
}
