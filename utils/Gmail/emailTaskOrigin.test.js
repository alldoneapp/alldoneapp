import { getEmailTaskActivityTime, isEmailOriginTask } from './emailTaskOrigin'
import { isGmailLabelFollowUpTask, isInboxSummaryGmailTask } from './gmailTaskUtils'

// AT-3151 - synthetic fixtures only.
const FIXTURES = {
    followUpReply: {
        gmailData: { origin: 'gmail_label_follow_up', messageId: 'm1', receivedAt: 10 },
        messageData: { needsReply: true, lastMessageAt: 10 },
    },
    followUpNoReply: { gmailData: { origin: 'gmail_label_follow_up', messageId: 'm2' } },
    followUpWithoutMessageId: { gmailData: { origin: 'gmail_label_follow_up' } },
    legacyInboxSummary: { gmailData: { gmailEmail: 'owner@example.com', unreadMails: 2 } },
    microsoft: { gmailData: { provider: 'microsoft', messageId: 'ms-1' } },
    bundleTodo: { gmailData: { origin: 'gmail_label_follow_up', messageId: 'm3', bundle: { id: 'b1' } } },
    // Mapped tasks always carry the field (`mapTaskData` writes `gmailData: null` for a normal task).
    normal: { gmailData: null },
    normalWithMessageData: { gmailData: null, messageData: { needsReply: true } },
}

const badgeShown = task => isInboxSummaryGmailTask(task) || isGmailLabelFollowUpTask(task)

describe('isEmailOriginTask', () => {
    it.each(Object.entries(FIXTURES))('agrees with the Email badge for %s', (name, task) => {
        expect(isEmailOriginTask(task)).toBe(badgeShown(task))
    })

    it('counts every email variant and no normal task', () => {
        const emailNames = Object.keys(FIXTURES).filter(name => isEmailOriginTask(FIXTURES[name]))
        expect(emailNames).toEqual([
            'followUpReply',
            'followUpNoReply',
            'followUpWithoutMessageId',
            'legacyInboxSummary',
            'microsoft',
            'bundleTodo',
        ])
    })

    it('does not count a task object without the gmailData field', () => {
        expect(isEmailOriginTask({ id: 'task-1', userIds: ['user-1'] })).toBe(false)
    })

    it('tolerates missing input', () => {
        expect(isEmailOriginTask(null)).toBe(false)
        expect(isEmailOriginTask(undefined)).toBe(false)
    })
})

describe('getEmailTaskActivityTime', () => {
    it('takes the newest email timestamp the task carries', () => {
        expect(
            getEmailTaskActivityTime({
                messageData: { lastMessageAt: 5 },
                gmailData: { receivedAt: 3, lastEmailReceivedAt: 7, bundle: { lastItemAt: 6 } },
            })
        ).toBe(7)
    })

    it('falls back to the creation time, then to 0', () => {
        expect(getEmailTaskActivityTime({ gmailData: { messageId: 'm' }, created: 42 })).toBe(42)
        expect(getEmailTaskActivityTime({ gmailData: { messageId: 'm' } })).toBe(0)
        expect(getEmailTaskActivityTime(null)).toBe(0)
    })

    it('ignores non-numeric timestamps', () => {
        expect(getEmailTaskActivityTime({ gmailData: { receivedAt: 'yesterday' }, created: NaN })).toBe(0)
    })
})
