// MCP feed parity: Gmail and Calendar. Cloud Functions write these entries on the project
// (functions/Feeds/integrationToolFeeds.js); the web must know the same values and route them to the
// project object, where ProjectObjectBody renders them through RegularFeed ("<actor> <entryText>").

import {
    FEED_PROJECT_CALENDAR_ACTIVITY,
    FEED_PROJECT_EMAIL_ACTIVITY,
    FEED_PROJECT_INTEGRATION_ACTIVITY_TYPES,
    FEED_PROJECT_TYPES,
    FEEDS_TYPES_TO_PARSE,
} from '../../components/Feeds/Utils/FeedsConstants'

const serverConstants = require('../../functions/Feeds/FeedsConstants')

describe('Gmail and Calendar activity feed types', () => {
    test('match the values Cloud Functions write', () => {
        expect(FEED_PROJECT_EMAIL_ACTIVITY).toBe(serverConstants.FEED_PROJECT_EMAIL_ACTIVITY)
        expect(FEED_PROJECT_CALENDAR_ACTIVITY).toBe(serverConstants.FEED_PROJECT_CALENDAR_ACTIVITY)
        expect(FEED_PROJECT_INTEGRATION_ACTIVITY_TYPES).toEqual([
            FEED_PROJECT_EMAIL_ACTIVITY,
            FEED_PROJECT_CALENDAR_ACTIVITY,
        ])
    })

    test('are project feeds, shown as plain text', () => {
        expect(FEED_PROJECT_TYPES).toEqual(expect.arrayContaining(FEED_PROJECT_INTEGRATION_ACTIVITY_TYPES))
        FEED_PROJECT_INTEGRATION_ACTIVITY_TYPES.forEach(type => expect(FEEDS_TYPES_TO_PARSE).not.toContain(type))
    })
})
