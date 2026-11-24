jest.mock('firebase-admin/functions', () => ({ getFunctions: jest.fn() }))

const { enqueueWhatsAppQueueRun } = require('./whatsAppQueueDispatch')
const { WHATSAPP_FUNCTION_TIMEOUT_SECONDS } = require('../Assistant/assistantRunLimits')

describe('WhatsApp queue dispatch', () => {
    test('hands the user to the worker with the full transport deadline and an id per event', async () => {
        const queue = { enqueue: jest.fn(async () => {}) }
        await expect(enqueueWhatsAppQueueRun('u1', 'message:MM1', { queue })).resolves.toEqual({ enqueued: true })
        await enqueueWhatsAppQueueRun('u1', 'message:MM1', { queue })
        await enqueueWhatsAppQueueRun('u1', 'message:MM2', { queue })

        const [payload, options] = queue.enqueue.mock.calls[0]
        expect(payload).toEqual({ userId: 'u1' })
        expect(options.dispatchDeadlineSeconds).toBe(WHATSAPP_FUNCTION_TIMEOUT_SECONDS)
        expect(queue.enqueue.mock.calls[1][1].id).toBe(options.id)
        expect(queue.enqueue.mock.calls[2][1].id).not.toBe(options.id)
    })

    test('treats a redelivered trigger as already dispatched', async () => {
        const queue = {
            enqueue: jest.fn(async () => {
                throw Object.assign(new Error('exists'), { code: 'functions/task-already-exists' })
            }),
        }
        await expect(enqueueWhatsAppQueueRun('u1', 'message:MM1', { queue })).resolves.toEqual({ duplicate: true })
    })

    test('reports other enqueue failures so the item stays pending for recovery', async () => {
        const queue = { enqueue: jest.fn(async () => Promise.reject(new Error('PERMISSION_DENIED'))) }
        await expect(enqueueWhatsAppQueueRun('u1', 'message:MM1', { queue })).rejects.toThrow('PERMISSION_DENIED')
        await expect(enqueueWhatsAppQueueRun('', 'message:MM1', { queue })).resolves.toEqual({ skipped: true })
    })
})
