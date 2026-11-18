'use strict'

// When a profile run happens: at 04:00 in the user's own day, an hour after their project wikis
// (knowledgeBaseSchedule.js), and only while the user is active. "Active" is the heartbeat rule (a
// login within 30 days), taken from the wiki's schedule so the two can never disagree about whom
// they spend Gold on.

const { getUserLocalDayStart } = require('../GoogleCalendar/calendarUserDay')
const { isKnowledgeBaseOwnerActive } = require('../KnowledgeBase/knowledgeBaseSchedule')

const ASSISTANT_PROFILE_NIGHTLY_HOUR = 4

function nextAssistantProfileRunAt(now, userData = {}) {
    const dayStart = getUserLocalDayStart(userData, now)
    const tonight = dayStart.clone().add(ASSISTANT_PROFILE_NIGHTLY_HOUR, 'hours').valueOf()
    return tonight > now
        ? tonight
        : dayStart.clone().add(1, 'day').add(ASSISTANT_PROFILE_NIGHTLY_HOUR, 'hours').valueOf()
}

function isAssistantProfileOwnerActive(userData, now = Date.now()) {
    return isKnowledgeBaseOwnerActive(userData, now)
}

module.exports = {
    ASSISTANT_PROFILE_NIGHTLY_HOUR,
    nextAssistantProfileRunAt,
    isAssistantProfileOwnerActive,
}
