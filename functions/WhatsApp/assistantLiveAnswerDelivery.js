const crypto = require('crypto')

// Stay conservatively below 500 tokens even for CJK, preserving every character.
function splitLiveAnswer(text) {
    const chunks = []
    let chunk = ''
    for (const char of String(text)) {
        if (Buffer.byteLength(chunk + char, 'utf8') > 400) {
            chunks.push(chunk)
            chunk = ''
        }
        chunk += char
    }
    if (chunk) chunks.push(chunk)
    return chunks
}

function createLiveAnswerDelivery({ result, delegationId, append, record, finish, supersede }) {
    let stage = 'queued'
    let sentAt = 0
    let retry = 0
    let outputObserved = false
    let pending = new Set()
    const chunks = splitLiveAnswer(result)
    const send = (type, content) => {
        const id = `alldone_live_answer_${crypto.randomUUID()}`
        pending.add(id)
        append(type, content, delegationId, id)
    }
    const context = () => {
        stage = 'context'
        sentAt = Date.now()
        pending.clear()
        chunks.forEach((chunk, index) =>
            send('session.thinking.append', `Completed backend result ${index + 1}/${chunks.length}:\n${chunk}`)
        )
        record({ deliveryStatus: 'context_sent', resultParts: chunks.length, contextSentAt: sentAt })
    }
    return {
        get pending() {
            return ['queued', 'context', 'ready', 'answer'].includes(stage)
        },
        get awaitingSpeech() {
            return ['answer', 'observing'].includes(stage)
        },
        close() {
            if (['queued', 'context', 'ready', 'answer'].includes(stage))
                record({
                    deliveryStatus: 'call_closed_before_ack',
                    deliveryCloseStage: stage,
                    deliveryClosedAt: Date.now(),
                })
            stage = 'done'
            pending.clear()
        },
        cancel() {
            if (stage === 'done') return
            const needsReconciliation = ['queued', 'context', 'ready'].includes(stage)
            stage = 'done'
            pending.clear()
            record({
                deliveryStatus: needsReconciliation ? 'superseded' : 'followup_after_answer',
                interruptedAt: Date.now(),
            })
            if (needsReconciliation) supersede()
        },
        acknowledge(event) {
            const expectedType = stage === 'context' ? 'session.thinking.appended' : 'session.commentary.appended'
            if (event.type !== expectedType || !pending.delete(event.client_event_id)) return
            if (pending.size) return
            if (stage === 'context') {
                stage = 'ready'
                record({ deliveryStatus: 'context_acknowledged', contextAcknowledgedAt: Date.now() })
            } else if (stage === 'answer') {
                stage = 'observing'
                sentAt = Date.now()
                record({ deliveryStatus: 'answer_acknowledged', answerAcknowledgedAt: sentAt })
                // Acceptance is not evidence of speech or playback.
                finish()
            }
        },
        observeOutput() {
            if (!['answer', 'observing'].includes(stage) || outputObserved) return
            outputObserved = true
            record({ outputObservedAfterAnswerAt: Date.now() })
        },
        tick({ active, lastSpeechAt }) {
            if (!active || stage === 'done') return
            const now = Date.now()
            if (stage === 'queued') context()
            if (['context', 'answer'].includes(stage) && now - sentAt >= 6000) {
                record({ deliveryStatus: 'ack_timeout', deliveryTimeoutStage: stage, deliveryRetry: retry })
                if (stage === 'context' && retry++ === 0) context()
                else {
                    stage = 'done'
                    // Do not replay a possibly-spoken answer or re-execute tools.
                    append(
                        'session.instructions.append',
                        'The backend finished, but voice delivery could not be confirmed. The full result is saved in the chat. Do not claim the backend is still working or repeat any action.',
                        delegationId
                    )
                    finish()
                }
            }
            if (now - lastSpeechAt < 1500) return
            if (stage === 'ready') {
                stage = 'answer'
                sentAt = now
                pending.clear()
                append(
                    'session.instructions.append',
                    'The backend has finished this request. Use its completed result to answer at the next pause. This replaces earlier waiting/progress messages. Never say you are still waiting for this result. If interrupted by an acknowledgment or a status question, retain the answer and resume it; delegate substantive corrections before acting.',
                    delegationId
                )
                send(
                    'session.commentary.append',
                    chunks.length === 1
                        ? result
                        : 'The complete backend result is available in the preceding numbered context parts. Give its concise answer now, including any required confirmation or next step. The full result is also in the chat.'
                )
                record({ deliveryStatus: 'answer_sent', answerSentAt: sentAt })
            } else if (stage === 'observing' && now - sentAt >= 10000) {
                stage = 'done'
                if (!outputObserved) {
                    append(
                        'session.instructions.append',
                        'A completed backend answer was accepted, but no subsequent speech has been observed. If you have not already conveyed that result, give it at the next pause. Do not repeat an answer already given or re-run tools.',
                        delegationId
                    )
                    record({ deliveryStatus: 'speech_unobserved', recoveryPromptAt: now })
                }
            }
        },
    }
}

module.exports = { createLiveAnswerDelivery, splitLiveAnswer }
