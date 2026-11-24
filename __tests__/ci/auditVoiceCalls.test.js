/** @jest-environment node */
const { auditVoiceCalls, summarizeCalls } = require('../../ci/auditVoiceCalls')

const row = (id, values) => ({
    document: {
        name: `projects/test/databases/(default)/documents/whatsAppCallSessions/${id}`,
        fields: Object.fromEntries(
            Object.entries(values).map(([key, value]) => [
                key,
                typeof value === 'number' ? { integerValue: String(value) } : { stringValue: value },
            ])
        ),
    },
})

test('distinguishes accepted call modes from routing configuration and incomplete metadata', () => {
    const report = summarizeCalls(
        [
            row('app', {
                channel: 'browser_call',
                voiceProvider: 'gpt-live',
                voiceModel: 'gpt-live-1',
                acceptCompletedAt: 10,
            }),
            row('phone', { channel: 'phone_call', realtimeModel: 'gpt-realtime-2', acceptCompletedAt: 10 }),
            row('routing', { channel: 'phone_call', realtimeModel: 'gpt-realtime-2' }),
            row('old', { channel: 'whatsapp_call', acceptCompletedAt: 10 }),
            { readTime: '2026-10-19T00:00:00Z' },
        ],
        10
    )
    expect(report.counts).toEqual({ live: 1, legacy: 1, unknown: 1, unaccepted: 1 })
    expect(report.byChannel.phone_call).toEqual({ live: 0, legacy: 1, unknown: 0, unaccepted: 1 })
    expect(report.acceptedExceptions.map(call => call.sessionId)).toEqual(['phone', 'old'])
    expect(report.sampleMayBeTruncated).toBe(false)
    expect(summarizeCalls([row('one', {})], 1).sampleMayBeTruncated).toBe(true)
    expect(summarizeCalls([{ readTime: 'now' }], 1).sampledCalls).toBe(0)
})

const env = { GOOGLE_CLOUD_PROJECT: 'test-project', GCP_ACCESS_TOKEN: 'private-token' }

test('uses a bounded read-only query that excludes conversation content and credentials', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: true, json: async () => [] }))
    const report = await auditVoiceCalls({ env, fetchImpl, since: '2026-10-19T00:00:00Z', limit: 25 })
    const [url, request] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://firestore.googleapis.com/v1/projects/test-project/databases/(default)/documents:runQuery')
    expect(request.method).toBe('POST')
    expect(request.headers.Authorization).toBe('Bearer private-token')
    const { structuredQuery } = JSON.parse(request.body)
    expect(structuredQuery.limit).toBe(25)
    expect(structuredQuery.where.fieldFilter.value).toEqual({ integerValue: String(Date.parse(report.since)) })
    expect(structuredQuery.select.fields.map(field => field.fieldPath)).toEqual([
        'channel',
        'voiceProvider',
        'voiceModel',
        'realtimeModel',
        'status',
        'createdAt',
        'acceptCompletedAt',
    ])
    expect(JSON.stringify(report)).not.toContain('private-token')
})

test('reports HTTP and transport failures without including provider bodies or request secrets', async () => {
    const text = jest.fn(() => 'sensitive-provider-body')
    await expect(auditVoiceCalls({ env, fetchImpl: async () => ({ ok: false, status: 403, text }) })).rejects.toThrow(
        'Voice audit read failed (HTTP 403)'
    )
    expect(text).not.toHaveBeenCalled()
    await expect(
        auditVoiceCalls({
            env,
            fetchImpl: async () => {
                throw new Error('private-token')
            },
        })
    ).rejects.toThrow('Voice audit request failed or timed out; no configuration was changed.')
    await expect(
        auditVoiceCalls({
            env,
            fetchImpl: async () => ({
                ok: true,
                json: async () => {
                    throw new Error('sensitive-provider-body')
                },
            }),
        })
    ).rejects.toThrow('Unexpected Firestore query response.')
})

test.each([{ env: {} }, { since: 'invalid' }, { limit: 501 }, { limit: 1.5 }])(
    'validates credentials and query bounds before accessing Firestore: %j',
    async overrides => {
        const fetchImpl = jest.fn()
        await expect(auditVoiceCalls({ env, fetchImpl, ...overrides })).rejects.toThrow()
        expect(fetchImpl).not.toHaveBeenCalled()
    }
)
