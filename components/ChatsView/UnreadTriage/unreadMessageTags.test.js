import {
    UNREAD_SORT_NEWEST,
    UNREAD_SORT_SENDER,
    UNREAD_TAG_ADS,
    UNREAD_TAG_ALL,
    UNREAD_TAG_ASSISTANT,
    UNREAD_TAG_EMAIL,
    UNREAD_TAG_NEWSLETTER,
    UNREAD_TAG_NOTIFICATION,
    UNREAD_TAG_PEOPLE,
    countRowsByTag,
    filterRowsByTag,
    getEmailRowContent,
    getMessageTime,
    getUnreadMessageTag,
    isEmailMessage,
    parseEmailCommentLine,
    sortRows,
    toOneLineSummary,
} from './unreadMessageTags'
import { isAdsArchived, isUnreadEmailKindArchived, normalizeUnreadEmailSettings } from './unreadEmailSettings'

const email = gmailData => ({ id: 'c1', fromAssistant: true, gmailData: { messageId: 'm1', ...gmailData } })

describe('getUnreadMessageTag', () => {
    test('the Ads label wins over the classifier kind', () => {
        expect(getUnreadMessageTag(email({ labelKey: 'ads', emailKind: 'newsletter' }))).toBe(UNREAD_TAG_ADS)
    })

    test('a custom newsletter label wins over the classifier kind', () => {
        expect(getUnreadMessageTag(email({ labelKey: 'Newsletter', emailKind: 'ads' }))).toBe(UNREAD_TAG_NEWSLETTER)
    })

    test('a project label leaves it to the classifier kind', () => {
        expect(getUnreadMessageTag(email({ labelKey: 'project_privat', emailKind: 'notification' }))).toBe(
            UNREAD_TAG_NOTIFICATION
        )
        expect(getUnreadMessageTag(email({ emailKind: 'person' }))).toBe(UNREAD_TAG_PEOPLE)
        expect(getUnreadMessageTag(email({ emailKind: 'newsletter' }))).toBe(UNREAD_TAG_NEWSLETTER)
    })

    test('an email from before the tag fields existed is "Other emails"', () => {
        expect(getUnreadMessageTag(email({}))).toBe(UNREAD_TAG_EMAIL)
        expect(getUnreadMessageTag(email({ emailKind: 'spam' }))).toBe(UNREAD_TAG_EMAIL)
    })

    test('chat comments are from a person or from an assistant', () => {
        expect(getUnreadMessageTag({ id: 'c2', fromAssistant: false, commentText: 'Hi' })).toBe(UNREAD_TAG_PEOPLE)
        expect(getUnreadMessageTag({ id: 'c3', fromAssistant: true, commentText: 'Done' })).toBe(UNREAD_TAG_ASSISTANT)
    })

    test('a comment an MCP client wrote in the user\'s name is an assistant message, not "From people"', () => {
        expect(
            getUnreadMessageTag({
                id: 'c4',
                fromAssistant: false,
                via: 'mcp',
                viaClient: 'Claude',
                commentText: 'Done',
            })
        ).toBe(UNREAD_TAG_ASSISTANT)
    })

    test("the owner's own sent mail is not an email row", () => {
        expect(isEmailMessage({ fromAssistant: false, gmailData: { messageId: 'm', direction: 'outgoing' } })).toBe(
            false
        )
        expect(isEmailMessage({ source: 'gmail_thread_sent', gmailData: { messageId: 'm' } })).toBe(false)
    })
})

describe('email row content', () => {
    test('parses the labeling sync line', () => {
        expect(
            parseEmailCommentLine(
                'Email from Facebook (notification@priority.facebookmail.com): Facebook meldet ungelesene Nachrichten.'
            )
        ).toEqual({
            senderName: 'Facebook',
            senderEmail: 'notification@priority.facebookmail.com',
            summary: 'Facebook meldet ungelesene Nachrichten.',
        })
    })

    test('tolerates the LINK: prefix and a German line', () => {
        expect(parseEmailCommentLine('LINK: E-Mail von Peter (peter@web.de): Vertrag kommt.')).toMatchObject({
            senderName: 'Peter',
            summary: 'Vertrag kommt.',
        })
    })

    test('prefers the structured sender written since the unread list exists', () => {
        const message = {
            commentText: 'Email from Quora (digest@quora.com): Daily digest.',
            gmailData: { messageId: 'm1', fromName: 'Quora Digest', fromEmail: 'digest@quora.com' },
        }
        expect(getEmailRowContent(message)).toEqual({
            senderName: 'Quora Digest',
            senderEmail: 'digest@quora.com',
            summary: 'Daily digest.',
        })
    })

    test('a line that does not parse is the summary as a whole', () => {
        expect(getEmailRowContent({ commentText: 'Something else', gmailData: { messageId: 'm1' } })).toEqual({
            senderName: '',
            senderEmail: '',
            summary: 'Something else',
        })
    })
})

describe('getMessageTime', () => {
    test('reads numbers and Firestore timestamps', () => {
        expect(getMessageTime({ created: 5 })).toBe(5)
        expect(getMessageTime({ lastChangeDate: { seconds: 2 } })).toBe(2000)
        expect(getMessageTime({ created: { toMillis: () => 7 } })).toBe(7)
        expect(getMessageTime({})).toBe(0)
    })
})

describe('rows', () => {
    const rows = [
        { key: 'a', tag: UNREAD_TAG_ADS, senderName: 'Zalando', time: 3 },
        { key: 'b', tag: UNREAD_TAG_PEOPLE, senderName: 'anna', time: 1 },
        { key: 'c', tag: UNREAD_TAG_ADS, senderName: 'Anna', time: 2 },
    ]

    test('counts per tag and in total', () => {
        expect(countRowsByTag(rows)).toEqual({ [UNREAD_TAG_ALL]: 3, [UNREAD_TAG_ADS]: 2, [UNREAD_TAG_PEOPLE]: 1 })
    })

    test('filters by tag, all keeps everything', () => {
        expect(filterRowsByTag(rows, UNREAD_TAG_ADS).map(row => row.key)).toEqual(['a', 'c'])
        expect(filterRowsByTag(rows, UNREAD_TAG_ALL)).toHaveLength(3)
    })

    test('sorts newest first, or by sender and then newest first', () => {
        expect(sortRows(rows, UNREAD_SORT_NEWEST).map(row => row.key)).toEqual(['a', 'c', 'b'])
        expect(sortRows(rows, UNREAD_SORT_SENDER).map(row => row.key)).toEqual(['c', 'b', 'a'])
    })
})

describe('unread email settings', () => {
    test('show both by default, archive only on an explicit value', () => {
        expect(normalizeUnreadEmailSettings(undefined)).toEqual({ newsletter: 'show', ads: 'show' })
        expect(normalizeUnreadEmailSettings({ ads: 'archive', newsletter: 'yes' })).toEqual({
            newsletter: 'show',
            ads: 'archive',
        })
        expect(isUnreadEmailKindArchived({ ads: 'archive' }, 'ads')).toBe(true)
        expect(isUnreadEmailKindArchived({}, 'newsletter')).toBe(false)
    })

    test("one ads switch: the user's choice wins, the connection's old value counts until then", () => {
        expect(isAdsArchived({ ads: 'show' }, true)).toBe(false)
        expect(isAdsArchived({ ads: 'archive' }, false)).toBe(true)
        expect(isAdsArchived({}, true)).toBe(true)
        expect(isAdsArchived(undefined)).toBe(false)
    })
})

describe('toOneLineSummary', () => {
    test('drops markdown so a heading does not become a "##" hashtag chip', () => {
        expect(
            toOneLineSummary(
                '## Ergebnis: Gemergt\nMR 893 ist **gemergt**. Der Job `deploy:web` lief, *nicht* aber:\n- [Pipeline](https://x.y/1)\n> Zitat'
            )
        ).toBe('Ergebnis: Gemergt MR 893 ist gemergt. Der Job deploy:web lief, nicht aber: Pipeline Zitat')
    })

    test('keeps hashtags, mentions and code block content', () => {
        expect(toOneLineSummary('#release für @Jana\n```js\nrun()\n```')).toBe('#release für @Jana run()')
    })

    test('copes with empty input', () => {
        expect(toOneLineSummary(undefined)).toBe('')
    })
})
