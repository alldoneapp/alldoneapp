/**
 * @jest-environment jsdom
 *
 * AT-2592 — an assistant chosen from the assistant-line @ picker must use the same resolved
 * mention payload as a person. In particular, the assistant id must survive serialization as
 * `@Name#id`; a URL embed has no mention id for downstream parsing to detect.
 */
jest.mock('../../../utils/BackendBridge', () => ({}))
jest.mock('../Utils/HelperFunctions', () => ({
    ATTACHMENT_TRIGGER: 'ATTACHMENT_TRIGGER',
    IMAGE_TRIGGER: 'IMAGE_TRIGGER',
    KARMA_TRIGGER: 'KARMA_TRIGGER',
    MENTION_SPACE_CODE: 'M2mVOSjAVPPKweL',
    REGEX_ATTACHMENT: /(?:)/,
    REGEX_EMAIL: /(?:)/,
    REGEX_GENERIC: /(?:)/,
    REGEX_HASHTAG: /(?:)/,
    REGEX_IMAGE: /(?:)/,
    REGEX_KARMA: /(?:)/,
    REGEX_MENTION: /(?:)/,
    REGEX_MILESTONE_TAG: /(?:)/,
    REGEX_URL: /(?:)/,
    REGEX_VIDEO: /(?:)/,
    tryToextractPeopleForMention: jest.fn(),
    VIDEO_TRIGGER: 'VIDEO_TRIGGER',
}))
jest.mock('../../../utils/LinkingHelper', () => ({
    formatUrl: jest.fn(),
    getDvMainTabLink: jest.fn(),
    getUrlObject: jest.fn(),
}))
jest.mock('../../Premium/PremiumHelper', () => ({ checkIsLimitedByTraffic: jest.fn(() => false) }))

import { buildResolvedPeopleMention } from './textInputHelper'

describe('buildResolvedPeopleMention', () => {
    it('keeps the selected assistant id and encodes spaces in its display name', () => {
        expect(
            buildResolvedPeopleMention(
                { uid: 'assistant-42', displayName: 'Marty Marketing' },
                'mention-1',
                'editor-1',
                'user-1'
            )
        ).toEqual({
            text: 'MartyM2mVOSjAVPPKweLMarketing',
            id: 'mention-1',
            userId: 'assistant-42',
            editorId: 'editor-1',
            userIdAllowedToEditTags: 'user-1',
        })
    })
})
