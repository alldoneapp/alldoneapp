'use strict'

const mockCreateTaskUpdatedFeed = jest.fn()
const mockLoadFeedsGlobalState = jest.fn()
const mockBatchUpdate = jest.fn()
const mockBatchCommit = jest.fn()

jest.mock('firebase-admin', () => ({
    firestore: jest.fn(),
    app: jest.fn(() => ({ options: { projectId: 'alldonealeph' } })),
}))
jest.mock('../BatchWrapper/batchWrapper', () => ({
    BatchWrapper: class {
        update(...args) {
            return mockBatchUpdate(...args)
        }
        commit() {
            return mockBatchCommit()
        }
    },
}))
jest.mock('../Feeds/tasksFeeds', () => ({
    createTaskUpdatedFeed: (...args) => mockCreateTaskUpdatedFeed(...args),
}))
jest.mock('../Feeds/FeedsConstants', () => ({ FEED_TASK_ALERT_CHANGED: 579 }))
jest.mock('../GlobalState/globalState', () => ({
    loadFeedsGlobalState: (...args) => mockLoadFeedsGlobalState(...args),
}))
jest.mock('../Utils/HelperFunctionsCloud', () => ({ inProductionEnvironment: jest.fn(() => true) }))

const admin = require('firebase-admin')
const { checkAndTriggerTaskAlerts } = require('./taskAlertsCloud')

const USER_ID = 'user-1'
const PROJECT_ID = 'project-1'
const PAST_DUE = Date.now() - 60 * 1000

const snap = (id, data) => ({ id, data: () => data, ref: { path: `items/${PROJECT_ID}/tasks/${id}` } })

/**
 * Minimal Firestore stand-in shaped exactly like the reads/writes checkAndTriggerTaskAlerts
 * performs. Returns the recorded writes so each test can assert on the channel fan-out.
 */
function buildDb({ user, tasks }) {
    const writes = { push: [], whatsApp: [], email: [] }

    const queryStub = docs => {
        const stub = { where: () => stub, get: async () => ({ docs, size: docs.length }) }
        return stub
    }

    const db = {
        collection: path => {
            if (path === 'users') return queryStub([snap(USER_ID, user)])
            if (path === 'projects') {
                return queryStub([{ id: PROJECT_ID, data: () => ({ userIds: [USER_ID], active: true }) }])
            }
            if (path === `items/${PROJECT_ID}/tasks`) return queryStub(tasks)
            if (path === 'pushNotifications') {
                return { add: async data => writes.push.push(data) }
            }
            if (path === 'whatsAppNotifications') {
                return { add: async data => writes.whatsApp.push(data) }
            }
            throw new Error(`Unexpected collection: ${path}`)
        },
        doc: path => {
            if (path === `projects/${PROJECT_ID}`) {
                return {
                    get: async () => ({ exists: true, data: () => ({ name: 'Alldone Product', userIds: [USER_ID] }) }),
                }
            }
            if (path === `users/${USER_ID}`) {
                return { get: async () => ({ exists: true, id: USER_ID, data: () => user }) }
            }
            if (path.startsWith('emailNotifications/')) {
                return { set: async data => writes.email.push(data) }
            }
            throw new Error(`Unexpected doc: ${path}`)
        },
    }

    return { db, writes }
}

describe('checkAndTriggerTaskAlerts channel fan-out (AT-2211)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    const dueTask = extra => snap('task-1', { name: 'Call the dentist', dueDate: PAST_DUE, userId: USER_ID, ...extra })

    it('delivers a WhatsApp reminder set from WhatsApp even when the global toggle is off', async () => {
        const { db, writes } = buildDb({
            user: { phone: '+491700000000', receiveWhatsApp: false, lastLogin: Date.now() },
            tasks: [dueTask({ alertChannels: ['whatsapp'] })],
        })
        admin.firestore.mockReturnValue(db)

        const result = await checkAndTriggerTaskAlerts()

        expect(result.processed).toBe(1)
        expect(writes.whatsApp).toHaveLength(1)
        expect(writes.whatsApp[0]).toMatchObject({
            userId: USER_ID,
            userPhone: '+491700000000',
            projectId: PROJECT_ID,
            objectId: 'task-1',
            objectName: 'Call the dentist',
            updateText: 'alert time reached',
        })
    })

    it('still honours the global opt-in for reminders created in the app', async () => {
        const { db, writes } = buildDb({
            user: { phone: '+491700000000', receiveWhatsApp: true, lastLogin: Date.now() },
            tasks: [dueTask()],
        })
        admin.firestore.mockReturnValue(db)

        await checkAndTriggerTaskAlerts()

        expect(writes.whatsApp).toHaveLength(1)
    })

    it('sends no WhatsApp for an app-created reminder when the toggle is off', async () => {
        const { db, writes } = buildDb({
            user: { phone: '+491700000000', receiveWhatsApp: false, lastLogin: Date.now() },
            tasks: [dueTask()],
        })
        admin.firestore.mockReturnValue(db)

        await checkAndTriggerTaskAlerts()

        expect(writes.whatsApp).toHaveLength(0)
    })

    it('sends no WhatsApp when the user has no phone number, even if the task asked for it', async () => {
        const { db, writes } = buildDb({
            user: { receiveWhatsApp: false, lastLogin: Date.now() },
            tasks: [dueTask({ alertChannels: ['whatsapp'] })],
        })
        admin.firestore.mockReturnValue(db)

        await checkAndTriggerTaskAlerts()

        expect(writes.whatsApp).toHaveLength(0)
    })

    it('leaves push and email behaviour untouched by the WhatsApp routing', async () => {
        const { db, writes } = buildDb({
            user: {
                phone: '+491700000000',
                receiveWhatsApp: false,
                pushNotificationsStatus: true,
                receiveEmails: true,
                lastLogin: Date.now(),
            },
            tasks: [dueTask({ alertChannels: ['whatsapp'] })],
        })
        admin.firestore.mockReturnValue(db)

        await checkAndTriggerTaskAlerts()

        expect(writes.push).toHaveLength(1)
        expect(writes.push[0]).toMatchObject({ userIds: [USER_ID], type: 'Alert Notification', chatId: 'task-1' })
        expect(writes.email).toHaveLength(1)
        expect(writes.whatsApp).toHaveLength(1)
    })

    it('marks the task as triggered so the reminder is not sent twice', async () => {
        const { db } = buildDb({
            user: { phone: '+491700000000', receiveWhatsApp: false, lastLogin: Date.now() },
            tasks: [dueTask({ alertChannels: ['whatsapp'] })],
        })
        admin.firestore.mockReturnValue(db)

        await checkAndTriggerTaskAlerts()

        expect(mockBatchUpdate).toHaveBeenCalledWith(expect.anything(), { alertTriggered: true })
        expect(mockBatchCommit).toHaveBeenCalled()
    })

    it('skips a task whose alert already fired', async () => {
        const { db, writes } = buildDb({
            user: { phone: '+491700000000', receiveWhatsApp: true, lastLogin: Date.now() },
            tasks: [dueTask({ alertTriggered: true })],
        })
        admin.firestore.mockReturnValue(db)

        const result = await checkAndTriggerTaskAlerts()

        expect(result.processed).toBe(0)
        expect(writes.whatsApp).toHaveLength(0)
    })
})
