const { sanitizeCallDiagnostics } = require('./assistantCallDiagnostics')
test('keeps bounded lifecycle data and strips content, credentials and network addresses', () => {
    const data = sanitizeCallDiagnostics({
        reason: 'component_unmounted',
        peerState: 'connected',
        width: 844,
        height: 390,
        token: 'secret',
        sdp: 'private',
        ip: '192.0.2.1',
        events: Array.from({ length: 40 }, () => ({ event: 'resize', atMs: 123, width: 844, text: 'private' })),
    })
    expect(data.reason).toBe('component_unmounted')
    expect(data.events).toHaveLength(24)
    expect(JSON.stringify(data)).not.toMatch(/secret|private|192\.0/)
    expect(
        sanitizeCallDiagnostics({ reason: 'Bearer secret', peerState: 'secret', events: [null, { event: 'secret' }] })
    ).toEqual({ reason: 'cleanup', events: [] })
})

test('retains bounded microphone startup timing and levels without saving device names or audio', () => {
    const data = sanitizeCallDiagnostics({
        inputLevelPermille: 1800,
        inputMonitorReady: true,
        inputSending: false,
        microphoneLabel: 'Private headset name',
        events: [{ event: 'microphone_first_signal', atMs: 420, inputLevelPermille: 80, audio: 'private samples' }],
    })
    expect(data).toMatchObject({ inputLevelPermille: 1000, inputMonitorReady: true, inputSending: false })
    expect(data.events).toEqual([{ event: 'microphone_first_signal', atMs: 420, inputLevelPermille: 80 }])
    expect(JSON.stringify(data)).not.toMatch(/headset|samples/)
})
