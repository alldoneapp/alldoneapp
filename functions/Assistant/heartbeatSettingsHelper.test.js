const {
    DEFAULT_PROMPT,
    normalizeHeartbeatIntervalMs,
    normalizeHeartbeatChancePercent,
    parseHeartbeatTimeString,
    getNormalizedHeartbeatSettings,
    buildHeartbeatSettingsContextMessage,
} = require('./heartbeatSettingsHelper')

describe('heartbeatSettingsHelper', () => {
    test('rounds and clamps heartbeat interval to the supported range', () => {
        expect(normalizeHeartbeatIntervalMs(17 * 60 * 1000)).toBe(15 * 60 * 1000)
        expect(normalizeHeartbeatIntervalMs(63 * 60 * 1000)).toBe(60 * 60 * 1000)
        expect(normalizeHeartbeatIntervalMs(1 * 60 * 1000)).toBe(5 * 60 * 1000)
    })

    test('clamps heartbeat chance percent to 0..100', () => {
        expect(normalizeHeartbeatChancePercent(-5)).toBe(0)
        expect(normalizeHeartbeatChancePercent(35)).toBe(35)
        expect(normalizeHeartbeatChancePercent(120)).toBe(100)
    })

    test('parses heartbeat times in HH:mm format', () => {
        expect(parseHeartbeatTimeString('08:15')).toBe((8 * 60 + 15) * 60 * 1000)
        expect(parseHeartbeatTimeString('23:59')).toBe((23 * 60 + 59) * 60 * 1000)
        expect(parseHeartbeatTimeString('24:00')).toBeNull()
        expect(parseHeartbeatTimeString('9am')).toBeNull()
    })

    test('applies effective defaults for chance, WhatsApp, and prompt', () => {
        expect(
            getNormalizedHeartbeatSettings(
                {
                    isDefault: true,
                },
                {
                    projectId: 'project-1',
                    userData: { defaultProjectId: 'project-1', phone: '+49123456' },
                }
            )
        ).toMatchObject({
            intervalMinutes: 30,
            chancePercent: 10,
            sendWhatsApp: true,
            prompt: DEFAULT_PROMPT,
        })
    })

    test('builds context text including the current heartbeat prompt', () => {
        const contextMessage = buildHeartbeatSettingsContextMessage(
            {
                heartbeatIntervalMs: 20 * 60 * 1000,
                heartbeatChancePercent: 45,
                heartbeatAwakeStart: 9 * 60 * 60 * 1000,
                heartbeatAwakeEnd: 18 * 60 * 60 * 1000,
                heartbeatSendWhatsApp: false,
                heartbeatPrompt: 'Check progress and remind about the focus task.',
            },
            { projectId: 'project-1', userData: { defaultProjectId: 'project-1' } }
        )

        expect(contextMessage).toContain('Current heartbeat settings for this assistant:')
        expect(contextMessage).toContain('Awake time: 09:00 - 18:00')
        expect(contextMessage).toContain('Heartbeat interval: 20 minutes')
        expect(contextMessage).toContain('Execution chance: 45%')
        expect(contextMessage).toContain('WhatsApp notification: disabled')
        expect(contextMessage).toContain('Check progress and remind about the focus task.')
    })
})
