const crypto = require('crypto')

// Stay conservatively below 500 tokens even for CJK, preserving every character.
function splitLiveAnswer(text) {
    const chunks = []
    let chunk = ''
    for (const char of String(text)) {
        if (Buffer.byteLength(chunk + char, 'utf8') > 400) {
            // Prefer a word boundary so adjacent spoken parts do not cut a word.
            const boundary = Math.max(chunk.lastIndexOf('\n'), chunk.lastIndexOf(' ')) + 1
            const split = boundary > chunk.length / 2 ? boundary : chunk.length
            chunks.push(chunk.slice(0, split))
            chunk = chunk.slice(split)
        }
        chunk += char
    }
    if (chunk) chunks.push(chunk)
    return chunks
}

function createLiveAnswerDelivery({ result, delegationId, append, record, finish, supersede }) {
    let stage = 'queued'
    let sentAt = 0
    let outputObserved = false
    const pending = new Set()
    const chunks = splitLiveAnswer(result)
    return {
        get pending() {
            return ['queued', 'answer'].includes(stage)
        },
        get awaitingSpeech() {
            return ['answer', 'observing'].includes(stage)
        },
        close() {
            if (['queued', 'answer'].includes(stage))
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
            const needsReconciliation = stage === 'queued'
            stage = 'done'
            pending.clear()
            record({
                deliveryStatus: needsReconciliation ? 'superseded' : 'followup_after_answer',
                interruptedAt: Date.now(),
            })
            if (needsReconciliation) supersede()
        },
        acknowledge(event) {
            if (
                stage !== 'answer' ||
                event.type !== 'session.commentary.appended' ||
                !pending.delete(event.client_event_id)
            )
                return
            if (pending.size) return
            stage = 'observing'
            sentAt = Date.now()
            record({ deliveryStatus: 'answer_acknowledged', answerAcknowledgedAt: sentAt })
            // Acceptance is not evidence of speech or playback.
        },
        observeOutput() {
            if (!['answer', 'observing'].includes(stage) || outputObserved) return
            outputObserved = true
            record({ outputObservedAfterAnswerAt: Date.now() })
        },
        tick({ active, lastSpeechAt }) {
            if (!active || stage === 'done') return
            const now = Date.now()
            if (stage === 'queued' && now - lastSpeechAt >= 1500) {
                stage = 'answer'
                sentAt = now
                // One delivery path: quiet context was already triggering an answer
                // before our later instructions/commentary repeated it. Send every
                // result part once, together, without another instruction to speak.
                chunks.forEach((chunk, index) => {
                    const id = `alldone_live_answer_${crypto.randomUUID()}`
                    pending.add(id)
                    append(
                        'session.commentary.append',
                        chunks.length === 1
                            ? chunk
                            : `Answer part ${index + 1}/${chunks.length} (continue, do not repeat):\n${chunk}`,
                        delegationId,
                        id
                    )
                })
                record({ deliveryStatus: 'answer_sent', answerSentAt: sentAt, resultParts: chunks.length })
            }
            if (stage === 'answer' && now - sentAt >= 6000) {
                stage = 'observing'
                pending.clear()
                record({ deliveryStatus: 'ack_timeout', deliveryTimeoutStage: 'answer' })
            }
            if (
                stage === 'observing' &&
                now - lastSpeechAt >= 1500 &&
                ((outputObserved && now - sentAt >= 3500) || now - sentAt >= 10000)
            ) {
                stage = 'done'
                // Missing transcript output is not proof that the user heard nothing.
                // Keep the saved answer for explicit follow-up; never auto-replay it.
                if (!outputObserved) record({ deliveryStatus: 'speech_unobserved', observedAt: now })
                finish()
            }
        },
    }
}

module.exports = { createLiveAnswerDelivery, splitLiveAnswer }
