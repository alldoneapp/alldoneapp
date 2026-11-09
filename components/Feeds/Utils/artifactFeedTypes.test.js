import * as webConstants from './FeedsConstants'
import { CREATION_TYPES, getFeedObjectTypes } from './HelperFunctions'
import { ARTIFACT_FEED_OBJECTS_TYPE, ARTIFACT_FEED_OBJECT_TYPE } from '../../../functions/Artifacts/artifactFeedModel'

const serverConstants = require('../../../functions/Feeds/FeedsConstants')

// The server writes the artifact entries (functions/Artifacts/artifactFeeds.js) and the app reads
// them by the same values; a type the app does not know leaves its card without an object.
describe('artifact entries in Updates', () => {
    it('use the same feed types on the server and in the app', () => {
        expect(webConstants.FEED_ARTIFACT_TYPES).toEqual(serverConstants.FEED_ARTIFACT_TYPES)
        expect(webConstants.FEED_ARTIFACT_TYPES).toHaveLength(9)
        Object.keys(serverConstants)
            .filter(key => key.startsWith('FEED_ARTIFACT_'))
            .forEach(key => expect([key, webConstants[key]]).toEqual([key, serverConstants[key]]))
        expect(webConstants.FEED_ARTIFACT_OBJECT_TYPE).toBe(ARTIFACT_FEED_OBJECT_TYPE)
    })

    it('belong to the artifacts object type, and the creation opens the card', () => {
        webConstants.FEED_ARTIFACT_TYPES.forEach(type =>
            expect(getFeedObjectTypes(type)).toBe(ARTIFACT_FEED_OBJECTS_TYPE)
        )
        expect(CREATION_TYPES).toContain(webConstants.FEED_ARTIFACT_CREATED)
        expect(webConstants.FEEDS_TYPES_TO_PARSE).toEqual(
            expect.arrayContaining([
                webConstants.FEED_ARTIFACT_TITLE_CHANGED,
                webConstants.FEED_ARTIFACT_DESCRIPTION_CHANGED,
            ])
        )
    })
})
