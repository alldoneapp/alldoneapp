const crypto = require('crypto')
const WebSocket = require('ws')

const DEFAULT_RECAP_TIMEOUT_MS = 20000
const EMPTY_CALL_RECAP = 'Your WhatsApp assistant call is complete. The transcript is available in Alldone.'
const RECAP_INSTRUCTIONS =
    'Write a short WhatsApp recap of this call in the caller language. Use at most three concise sentences. Mention decisions, actions, and unresolved follow-ups. Return only the recap text without a heading or label. No markdown and no URLs.'

function buildCallTranscriptText(transcript) {
    return (transcript || [])
        .filter(turn => ['assistant', 'user'].includes(turn?.role) && String(turn?.text || '').trim())
        .map(turn => `${turn.role === 'assistant' ? 'Assistant' : 'Caller'}: ${String(turn.text).trim()}`)
        .join('\n')
        .slice(-24000)
}

function getRealtimeResponseText(response) {
    return (response?.output || [])
        .flatMap(item => item.content || [])
        .map(item => item.text || '')
        .filter(Boolean)
        .join(' ')
        .trim()
}

function createRecapError(code, status = null) {
    const error = new Error('WhatsApp call recap generation failed')
    error.code = String(code || 'recap_generation_error').slice(0, 80)
    if (status) error.status = Number(status) || null
    return error
}

function getSafetyIdentifier(session) {
    const userId = String(session?.userId || '')
    return userId ? crypto.createHash('sha256').update(userId).digest('hex') : ''
}

async function generateCallRecap(config, session, transcript, options = {}) {
    const transcriptText = buildCallTranscriptText(transcript)
    if (!transcriptText) return { text: EMPTY_CALL_RECAP, tokens: 0 }

    const WebSocketImpl = options.WebSocketImpl || WebSocket
    const timeoutMs = Number(options.timeoutMs) || DEFAULT_RECAP_TIMEOUT_MS
    const safetyIdentifier = getSafetyIdentifier(session)

    return new Promise((resolve, reject) => {
        let socket
        let settled = false
        let responseRequested = false
        let timeout

        const finish = (error, result) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            if (socket?.readyState === WebSocketImpl.OPEN) socket.close()
            if (error) reject(error)
            else resolve(result)
        }
        const send = payload => {
            try {
                socket.send(JSON.stringify(payload))
            } catch (_) {
                finish(createRecapError('recap_socket_send_failed'))
            }
        }

        socket = new WebSocketImpl(
            `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(config.realtimeModel)}`,
            {
                headers: {
                    Authorization: `Bearer ${config.openAiApiKey}`,
                    ...(safetyIdentifier ? { 'OpenAI-Safety-Identifier': safetyIdentifier } : {}),
                },
            }
        )
        timeout = setTimeout(() => finish(createRecapError('recap_timeout')), timeoutMs)

        socket.once('open', () => {
            send({
                type: 'session.update',
                session: {
                    type: 'realtime',
                    model: config.realtimeModel,
                    output_modalities: ['text'],
                    instructions: RECAP_INSTRUCTIONS,
                    reasoning: { effort: config.reasoningEffort },
                    tools: [],
                },
            })
        })
        socket.on('message', data => {
            let event
            try {
                event = JSON.parse(data.toString())
            } catch (_) {
                finish(createRecapError('recap_invalid_event'))
                return
            }

            if (event.type === 'error') {
                finish(createRecapError(event.error?.code || event.error?.type || 'recap_openai_error'))
                return
            }
            if (event.type === 'session.updated' && !responseRequested) {
                responseRequested = true
                send({
                    type: 'response.create',
                    response: {
                        conversation: 'none',
                        output_modalities: ['text'],
                        input: [
                            {
                                type: 'message',
                                role: 'user',
                                content: [{ type: 'input_text', text: transcriptText }],
                            },
                        ],
                    },
                })
                return
            }
            if (event.type !== 'response.done') return

            const response = event.response || {}
            if (response.status !== 'completed') {
                finish(createRecapError(`recap_response_${response.status || 'failed'}`))
                return
            }
            const text = getRealtimeResponseText(response)
            if (!text) {
                finish(createRecapError('recap_empty_response'))
                return
            }
            finish(null, {
                text,
                tokens: Number(response.usage?.total_tokens) || 0,
                responseId: response.id || 'recap',
            })
        })
        socket.once('error', error => {
            finish(createRecapError(error?.code || 'recap_socket_error'))
        })
        socket.once('close', code => {
            if (!settled) finish(createRecapError(`recap_socket_closed_${Number(code) || 'unknown'}`))
        })
    })
}

module.exports = {
    EMPTY_CALL_RECAP,
    RECAP_INSTRUCTIONS,
    buildCallTranscriptText,
    generateCallRecap,
    getRealtimeResponseText,
}
