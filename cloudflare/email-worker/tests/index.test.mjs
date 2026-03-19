import assert from 'assert'

import { buildNormalizedPayload } from '../src/index.mjs'

function createHeaders(entries) {
    const map = new Map(entries)
    return {
        get(name) {
            const lowered = String(name).toLowerCase()
            for (const [key, value] of map.entries()) {
                if (String(key).toLowerCase() === lowered) return value
            }
            return null
        },
        entries() {
            return map.entries()
        },
    }
}

async function run() {
    {
        const payload = await buildNormalizedPayload({
            headers: createHeaders([
                ['from', 'Alice <alice@example.com>'],
                ['subject', 'Invoice April'],
                ['message-id', '<abc@example.com>'],
                ['reply-to', 'reply@example.com'],
                ['in-reply-to', '<prior@example.com>'],
                ['references', '<prior@example.com>'],
            ]),
            raw: Promise.resolve({
                text: async () => 'Please process this invoice',
            }),
            attachments: [],
        })

        assert.equal(payload.messageId, '<abc@example.com>')
        assert.equal(payload.fromEmail, 'alice@example.com')
        assert.equal(payload.subject, 'Invoice April')
        assert.equal(payload.textBody, 'Please process this invoice')
        assert.equal(payload.threadHeaders.replyTo, 'reply@example.com')
        assert.equal(payload.threadHeaders.inReplyTo, '<prior@example.com>')
        assert.equal(payload.threadHeaders.references, '<prior@example.com>')
        assert.deepEqual(payload.attachments, [])
    }

    {
        const mime = [
            'From: Alice <alice@example.com>',
            'Subject: Plain body',
            'Message-ID: <mime@example.com>',
            'Content-Type: text/plain; charset=utf-8',
            '',
            'Buy milk tomorrow',
        ].join('\r\n')

        const payload = await buildNormalizedPayload({
            headers: createHeaders([
                ['from', 'Alice <alice@example.com>'],
                ['subject', 'Plain body'],
                ['message-id', '<mime@example.com>'],
            ]),
            raw: Promise.resolve(
                new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(mime))
                        controller.close()
                    },
                })
            ),
            attachments: [],
        })

        assert.equal(payload.textBody, 'Buy milk tomorrow')
    }

    {
        const bytes = new Uint8Array([104, 101, 108, 108, 111])
        const payload = await buildNormalizedPayload({
            headers: createHeaders([
                ['from', 'Alice <alice@example.com>'],
                ['subject', 'Invoice'],
                ['message-id', '<def@example.com>'],
            ]),
            raw: Promise.resolve({
                text: async () => 'Please process attached invoice',
            }),
            attachments: [
                {
                    filename: 'invoice.pdf',
                    contentType: 'application/pdf',
                    arrayBuffer: async () => bytes.buffer,
                },
            ],
        })

        assert.equal(payload.attachments.length, 1)
        assert.equal(payload.attachments[0].fileName, 'invoice.pdf')
        assert.equal(payload.attachments[0].contentType, 'application/pdf')
        assert.equal(payload.attachments[0].contentBase64, 'aGVsbG8=')
        assert.equal(payload.attachments[0].sizeBytes, 5)
    }

    console.log('anna-email-worker tests passed')
}

run().catch(error => {
    console.error(error)
    process.exit(1)
})
