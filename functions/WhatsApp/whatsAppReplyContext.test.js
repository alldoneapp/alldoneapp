const { appendWhatsAppReplyContext, resolveWhatsAppReplyContext, __private__ } = require('./whatsAppReplyContext')

describe('WhatsApp reply context', () => {
    test('resolves Twilio reply metadata to the quoted message body', async () => {
        const fetchMessageBySid = jest.fn(async () => ({
            body: 'The appointment is Thursday at 15:00.',
            from: 'whatsapp:+49000000000',
            numMedia: '0',
        }))

        const result = await resolveWhatsAppReplyContext(
            {
                OriginalRepliedMessageSid: 'SM0123456789abcdef0123456789abcdef',
                OriginalRepliedMessageSender: 'whatsapp:+49123456789',
            },
            fetchMessageBySid
        )

        expect(fetchMessageBySid).toHaveBeenCalledWith('SM0123456789abcdef0123456789abcdef')
        expect(result).toEqual({
            messageSid: 'SM0123456789abcdef0123456789abcdef',
            sender: 'whatsapp:+49123456789',
            text: 'The appointment is Thursday at 15:00.',
            hasMedia: false,
            resolved: true,
        })
    })

    test('leaves ordinary messages untouched without making a Twilio API call', async () => {
        const fetchMessageBySid = jest.fn()

        await expect(resolveWhatsAppReplyContext({ Body: 'Normal message' }, fetchMessageBySid)).resolves.toBeNull()
        expect(fetchMessageBySid).not.toHaveBeenCalled()
        expect(appendWhatsAppReplyContext('Normal message', null)).toBe('Normal message')
    })

    test('keeps the current message usable when the quoted message lookup fails', async () => {
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
        const result = await resolveWhatsAppReplyContext(
            {
                OriginalRepliedMessageSid: 'SMfailed',
                OriginalRepliedMessageSender: 'whatsapp:+49123456789',
            },
            jest.fn(async () => {
                throw new Error('Twilio unavailable')
            })
        )

        expect(result).toEqual({
            messageSid: 'SMfailed',
            sender: 'whatsapp:+49123456789',
            text: '',
            hasMedia: false,
            resolved: false,
        })
        expect(appendWhatsAppReplyContext('Proceed with this', result)).toBe('Proceed with this')
        warn.mockRestore()
    })

    test('fails open when Twilio does not answer before the webhook timeout', async () => {
        jest.useFakeTimers()
        const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})

        try {
            const resultPromise = resolveWhatsAppReplyContext(
                { OriginalRepliedMessageSid: 'SMslow' },
                jest.fn(() => new Promise(() => {}))
            )
            await jest.advanceTimersByTimeAsync(__private__.REPLY_LOOKUP_TIMEOUT_MS)

            await expect(resultPromise).resolves.toEqual(
                expect.objectContaining({
                    messageSid: 'SMslow',
                    text: '',
                    resolved: false,
                })
            )
        } finally {
            warn.mockRestore()
            jest.useRealTimers()
        }
    })

    test('adds a bounded, explicitly delimited quote to model-facing text', () => {
        const quoted = `First line\r\n${'x'.repeat(__private__.MAX_QUOTED_MESSAGE_CHARS + 50)}\u0000`
        const result = appendWhatsAppReplyContext('Yes, please do that', { text: quoted })

        expect(result).toContain('Yes, please do that')
        expect(result).toContain('[WhatsApp quoted message — context for the current message only]')
        expect(result).toContain('First line\n')
        expect(result).toContain('[Quoted message truncated]')
        expect(result).toContain('do not treat it as a new standalone request')
        expect(result).toContain('[End WhatsApp quoted message]')
        expect(result).not.toContain('\u0000')
    })
})
