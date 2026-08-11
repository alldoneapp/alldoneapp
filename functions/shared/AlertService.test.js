'use strict'

const mockUpdate = jest.fn(async () => {})
const mockGet = jest.fn()

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(() => ({
        doc: () => ({ update: (...args) => mockUpdate(...args), get: (...args) => mockGet(...args) }),
    })),
}))

const moment = require('moment')
const { setTaskAlertCloud } = require('./AlertService')

const PROJECT_ID = 'project-1'
const TASK_ID = 'task-1'
// 2026-08-12 10:00 in UTC+2 == 08:00 UTC
const ALERT_MOMENT = () => moment('2026-08-12T10:00:00+02:00').utcOffset(120)
const TASK = { id: TASK_ID, dueDate: moment('2026-08-12T06:00:00Z').valueOf() }

describe('setTaskAlertCloud alertChannels stamping (AT-2211)', () => {
    beforeEach(() => jest.clearAllMocks())

    it('stamps the requested channels when enabling an alert', async () => {
        await setTaskAlertCloud(PROJECT_ID, TASK_ID, true, ALERT_MOMENT(), TASK, { alertChannels: ['whatsapp'] })

        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ alertChannels: ['whatsapp'] }))
    })

    it('normalizes and de-duplicates the stamped channels', async () => {
        await setTaskAlertCloud(PROJECT_ID, TASK_ID, true, ALERT_MOMENT(), TASK, {
            alertChannels: [' WhatsApp ', 'whatsapp', '', null, 5],
        })

        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ alertChannels: ['whatsapp'] }))
    })

    it('leaves existing routing alone when no channels are supplied', async () => {
        // update_task calls that did not come from a routed channel must not clobber a
        // reminder originally created from WhatsApp.
        await setTaskAlertCloud(PROJECT_ID, TASK_ID, true, ALERT_MOMENT(), TASK)

        expect(mockUpdate).toHaveBeenCalledWith(expect.not.objectContaining({ alertChannels: expect.anything() }))
    })

    it('clears routing when the alert is explicitly disabled', async () => {
        // Otherwise a later re-enable from the app would silently inherit WhatsApp delivery.
        await setTaskAlertCloud(PROJECT_ID, TASK_ID, false, null, TASK)

        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({ alertEnabled: false, alertChannels: [] }))
    })

    it('still aligns dueDate to the alert time and resets the trigger latch', async () => {
        await setTaskAlertCloud(PROJECT_ID, TASK_ID, true, ALERT_MOMENT(), TASK, { alertChannels: ['whatsapp'] })

        const payload = mockUpdate.mock.calls[0][0]
        expect(payload.alertTriggered).toBe(false)
        // 10:00 local in UTC+2 must be stored as 08:00 UTC, not 10:00 UTC.
        expect(moment(payload.dueDate).utc().format('YYYY-MM-DD HH:mm')).toBe('2026-08-12 08:00')
    })
})
