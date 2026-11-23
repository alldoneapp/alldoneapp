// Read-only rollout check for AT-2766. Requires Node 22; no Firebase SDK or paid call.
const CALL_FIELDS = [
    'channel',
    'voiceProvider',
    'voiceModel',
    'realtimeModel',
    'status',
    'createdAt',
    'acceptCompletedAt',
]

function summarizeCalls(rows, limit) {
    const calls = rows
        .filter(row => row.document)
        .map(({ document }) => {
            const values = Object.fromEntries(
                Object.entries(document.fields || {}).map(([key, value]) => [
                    key,
                    value.stringValue ?? value.integerValue ?? value.timestampValue ?? null,
                ])
            )
            // Routing stamps a realtimeModel before OpenAI chooses a protocol. Its presence
            // alone is not evidence that a Realtime call was actually accepted.
            const accepted = Number(values.acceptCompletedAt) > 0
            const mode = !accepted
                ? 'unaccepted'
                : values.voiceProvider === 'gpt-live' && values.voiceModel === 'gpt-live-1'
                  ? 'live'
                  : !values.voiceProvider && /^gpt-(?:realtime|4o.*realtime)/.test(values.realtimeModel || '')
                    ? 'legacy'
                    : 'unknown'
            return { sessionId: document.name.split('/').pop(), ...values, mode }
        })
    const counts = { live: 0, legacy: 0, unknown: 0, unaccepted: 0 }
    const byChannel = {}
    for (const call of calls) {
        counts[call.mode]++
        const channel = call.channel || 'unknown'
        const channelCounts = (byChannel[channel] ||= { live: 0, legacy: 0, unknown: 0, unaccepted: 0 })
        channelCounts[call.mode]++
    }
    return {
        sampledCalls: calls.length,
        sampleMayBeTruncated: calls.length >= limit,
        counts,
        byChannel,
        // Include correlation metadata only. CALL_FIELDS excludes user IDs, numbers,
        // SIP headers, routing credentials, audio and transcript content.
        acceptedExceptions: calls.filter(call => ['legacy', 'unknown'].includes(call.mode)),
    }
}

async function auditVoiceCalls({ env = process.env, fetchImpl = globalThis.fetch, since, limit = 100 } = {}) {
    const projectId = env.GOOGLE_CLOUD_PROJECT
    const token = env.GCP_ACCESS_TOKEN || env.CLOUDSDK_AUTH_ACCESS_TOKEN
    if (!projectId || !/^[a-z][a-z0-9-]+$/.test(projectId) || !token)
        throw new Error('Set GOOGLE_CLOUD_PROJECT and a read-only GCP_ACCESS_TOKEN or CLOUDSDK_AUTH_ACCESS_TOKEN.')
    const sinceMs = since === undefined ? Date.now() - 30 * 24 * 60 * 60 * 1000 : Date.parse(since)
    if (!Number.isFinite(sinceMs)) throw new Error('Use an ISO date for since, for example 2026-10-19T00:00:00Z.')
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('Limit must be an integer from 1 to 500.')

    let response
    try {
        response = await fetchImpl(
            `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`,
            {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(30000),
                body: JSON.stringify({
                    structuredQuery: {
                        from: [{ collectionId: 'whatsAppCallSessions' }],
                        select: { fields: CALL_FIELDS.map(fieldPath => ({ fieldPath })) },
                        where: {
                            fieldFilter: {
                                field: { fieldPath: 'createdAt' },
                                op: 'GREATER_THAN_OR_EQUAL',
                                value: { integerValue: String(sinceMs) },
                            },
                        },
                        orderBy: [{ field: { fieldPath: 'createdAt' }, direction: 'DESCENDING' }],
                        limit,
                    },
                }),
            }
        )
    } catch (_) {
        // Provider/network error bodies can contain request details. Never print them.
        throw new Error('Voice audit request failed or timed out; no configuration was changed.')
    }
    if (!response.ok) throw new Error(`Voice audit read failed (HTTP ${response.status}); check read-only access.`)
    let rows
    try {
        rows = await response.json()
    } catch (_) {
        throw new Error('Unexpected Firestore query response.')
    }
    if (!Array.isArray(rows)) throw new Error('Unexpected Firestore query response.')
    return { projectId, since: new Date(sinceMs).toISOString(), limit, ...summarizeCalls(rows, limit) }
}

if (require.main === module) {
    const [since, limit] = process.argv.slice(2)
    auditVoiceCalls({ since, limit: limit === undefined ? 100 : Number(limit) })
        .then(report => {
            console.log(JSON.stringify(report, null, 2))
            if (report.counts.legacy || report.counts.unknown) process.exitCode = 2
        })
        .catch(error => {
            console.error(error.message)
            process.exitCode = 1
        })
}

module.exports = { auditVoiceCalls, summarizeCalls }
