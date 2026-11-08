'use strict'

const fs = require('fs')
const path = require('path')

// Security audit 2026-11: these callables trusted ids from request.data. Each now resolves its
// request through a guard module (pinned by that module's own suite); this ratchets the wiring in
// index.js, which cannot be require()d in a test.

const readSource = () => fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8')

const readRegistrationBody = (source, name) => {
    const start = source.indexOf(`exports.${name} = `)
    if (start === -1) return null
    const next = source.indexOf('\nexports.', start + 1)
    return source.slice(start, next === -1 ? source.length : next)
}

const GUARDED_CALLABLES = [
    ['generateBotDailyTopicCommentSecondGen', 'resolveDailyTopicRequest(admin.firestore(), request)'],
    ['onRemoveWorkstreamSecondGen', 'assertWorkstreamRemovalAllowed(admin.firestore(), request)'],
    ['sendPushNotificationSecondGen', 'resolvePushNotificationRequest(admin.firestore(), request)'],
    ['sendUserJoinsToGuideEmailSecondGen', 'resolveGuideJoinEmailRequest('],
    ['createApiEmailTasksSecondGen', 'resolveApiEmailTaskRequest('],
    ['generateAssistantDelegationDescriptionSecondGen', '{ forWrite: true }'],
    ['addContactToBrevoMarketingList', 'resolveMarketingSubscriptionRequest(request)'],
]

describe('callables bind their request to request.auth.uid', () => {
    const source = readSource()

    test.each(GUARDED_CALLABLES)('%s goes through its guard', (name, guardCall) => {
        const body = readRegistrationBody(source, name)
        expect(body).toBeTruthy()
        expect(body).toContain(guardCall)
        // The raw request body must not reach the handler any more.
        expect(body).not.toMatch(/=\s*data\s*\n/)
        expect(body).not.toContain('processPushNotifications([data])')
        expect(body).not.toContain('...data')
    })

    test('addCalendarEventsToTasksSecondGen stays removed', () => {
        expect(source).not.toContain('exports.addCalendarEventsToTasksSecondGen')
    })

    test('the Brevo callable does not hand back the Brevo response', () => {
        const body = readRegistrationBody(source, 'addContactToBrevoMarketingList')
        expect(body).toContain('return { success: true }')
        expect(body).not.toContain('return await addContactToMarketingList')
    })
})
