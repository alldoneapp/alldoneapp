'use strict'

const {
    REMINDER_CHANNEL_WHATSAPP,
    ALERT_NOTIFICATION_TYPE,
    resolveReminderChannelsFromSource,
    getTaskReminderChannels,
    taskRequestsReminderChannel,
    shouldSendWhatsAppReminder,
} = require('./reminderChannels')

describe('resolveReminderChannelsFromSource (AT-2211)', () => {
    it('routes WhatsApp text messages back to WhatsApp', () => {
        expect(resolveReminderChannelsFromSource('whatsapp')).toEqual([REMINDER_CHANNEL_WHATSAPP])
    })

    it('treats a WhatsApp voice call as the same channel', () => {
        // From the user's side the call and the chat are one conversation on one phone.
        expect(resolveReminderChannelsFromSource('whatsapp_call')).toEqual([REMINDER_CHANNEL_WHATSAPP])
    })

    it('normalizes casing and surrounding whitespace', () => {
        expect(resolveReminderChannelsFromSource('  WhatsApp_Call ')).toEqual([REMINDER_CHANNEL_WHATSAPP])
    })

    it('implies no routing for other channels', () => {
        // These must keep the pre-AT-2211 behaviour: global settings alone decide.
        for (const channel of ['mcp', 'gmail', 'automatic_thread_compaction', '']) {
            expect(resolveReminderChannelsFromSource(channel)).toEqual([])
        }
    })

    it('is safe for missing or non-string input', () => {
        for (const value of [undefined, null, 42, {}, []]) {
            expect(resolveReminderChannelsFromSource(value)).toEqual([])
        }
    })
})

describe('getTaskReminderChannels', () => {
    it('reads the stamped channels', () => {
        expect(getTaskReminderChannels({ alertChannels: ['whatsapp'] })).toEqual(['whatsapp'])
    })

    it('tolerates legacy tasks with no alertChannels field', () => {
        expect(getTaskReminderChannels({})).toEqual([])
        expect(getTaskReminderChannels(null)).toEqual([])
        expect(getTaskReminderChannels(undefined)).toEqual([])
    })

    it('drops malformed entries instead of throwing', () => {
        expect(getTaskReminderChannels({ alertChannels: ['whatsapp', '', '   ', null, 7, {}] })).toEqual(['whatsapp'])
    })

    it('ignores a non-array alertChannels value', () => {
        expect(getTaskReminderChannels({ alertChannels: 'whatsapp' })).toEqual([])
    })
})

describe('taskRequestsReminderChannel', () => {
    it('matches case-insensitively', () => {
        expect(taskRequestsReminderChannel({ alertChannels: ['WhatsApp'] }, 'whatsapp')).toBe(true)
    })

    it('does not match an unrelated channel', () => {
        expect(taskRequestsReminderChannel({ alertChannels: ['whatsapp'] }, 'email')).toBe(false)
    })

    it('is false for an empty channel argument', () => {
        expect(taskRequestsReminderChannel({ alertChannels: ['whatsapp'] }, '')).toBe(false)
    })
})

describe('shouldSendWhatsAppReminder (AT-2211)', () => {
    const phone = '+491700000000'

    it('sends when the user opted in globally (pre-existing behaviour)', () => {
        expect(shouldSendWhatsAppReminder({ phone, receiveWhatsApp: true }, {})).toBe(true)
    })

    it('sends when the reminder was set from WhatsApp even though the global toggle is off', () => {
        // This is the actual AT-2211 bug: Karsten's receiveWhatsApp is false in production.
        expect(shouldSendWhatsAppReminder({ phone, receiveWhatsApp: false }, { alertChannels: ['whatsapp'] })).toBe(
            true
        )
    })

    it('does not send for an app-created reminder when the global toggle is off', () => {
        expect(shouldSendWhatsAppReminder({ phone, receiveWhatsApp: false }, { alertChannels: [] })).toBe(false)
        expect(shouldSendWhatsAppReminder({ phone, receiveWhatsApp: false }, {})).toBe(false)
    })

    it('never sends without a phone number, whatever the task requested', () => {
        expect(shouldSendWhatsAppReminder({ receiveWhatsApp: true }, { alertChannels: ['whatsapp'] })).toBe(false)
        expect(shouldSendWhatsAppReminder({ phone: '', receiveWhatsApp: true }, { alertChannels: ['whatsapp'] })).toBe(
            false
        )
    })

    it('is safe for a missing user', () => {
        expect(shouldSendWhatsAppReminder(null, { alertChannels: ['whatsapp'] })).toBe(false)
        expect(shouldSendWhatsAppReminder(undefined, {})).toBe(false)
    })
})

describe('ALERT_NOTIFICATION_TYPE', () => {
    it('keeps the deployed wire value so live queue docs stay recognised', () => {
        // Existing pushNotifications docs in production carry this exact string.
        expect(ALERT_NOTIFICATION_TYPE).toBe('Alert Notification')
    })
})
