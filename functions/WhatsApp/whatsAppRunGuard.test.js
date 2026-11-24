const { createWhatsAppRunGuard, WHATSAPP_WRAP_UP_WINDOW_MS, WHATSAPP_TIMEOUT_CODE } = require('./whatsAppRunGuard')

describe('WhatsApp run guard', () => {
    afterEach(() => jest.useRealTimers())

    test('asks for the final reply once less than the wrap-up window is left, before it aborts', async () => {
        jest.useFakeTimers()
        const guard = createWhatsAppRunGuard(Date.now() + WHATSAPP_WRAP_UP_WINDOW_MS + 30000)
        const running = guard.run(() => new Promise(() => {}))
        const rejected = expect(running).rejects.toMatchObject({ code: WHATSAPP_TIMEOUT_CODE })

        expect(guard.shouldWrapUp()).toBe(false)
        await jest.advanceTimersByTimeAsync(30000)
        expect(guard.shouldWrapUp()).toBe(true)
        expect(() => guard.assertActive()).not.toThrow()

        await jest.advanceTimersByTimeAsync(WHATSAPP_WRAP_UP_WINDOW_MS)
        await rejected
        expect(guard.signal.aborted).toBe(true)
    })

    test('keeps the wrap-up window a small share of the run budget', () => {
        const { WHATSAPP_PROMPT_MAX_RUN_WALL_CLOCK_MS } = require('../Assistant/assistantRunLimits')
        expect(WHATSAPP_WRAP_UP_WINDOW_MS).toBeGreaterThanOrEqual(60000)
        expect(WHATSAPP_WRAP_UP_WINDOW_MS).toBeLessThan(WHATSAPP_PROMPT_MAX_RUN_WALL_CLOCK_MS / 2)
    })
})
