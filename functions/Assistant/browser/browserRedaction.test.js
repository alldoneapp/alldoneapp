'use strict'

const {
    REDACTED,
    containsLikelySecret,
    describeTypedValue,
    redactForAudit,
    redactForModel,
    redactObjectForAudit,
    redactUrl,
} = require('./browserRedaction')

describe('browser redaction', () => {
    describe('what the model sees', () => {
        it('removes credentials from page text', () => {
            const page = [
                'Support token: ghp_abcdefghijklmnopqrstuvwxyz0123456789',
                'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abcdefghijklmno',
                'api_key = sk-livekeyabcdefghijklmnop',
            ].join('\n')
            const redacted = redactForModel(page)
            expect(redacted).not.toMatch(/ghp_/)
            expect(redacted).not.toMatch(/eyJhbGciOiJIUzI1NiJ9/)
            expect(redacted).not.toMatch(/sk-livekey/)
            expect(redacted).toContain(REDACTED)
        })

        it('KEEPS the page content the user asked for', () => {
            // The split that makes this feature usable: a ticket page's contact address and prices
            // must survive, or the assistant reads a redacted blank.
            const page = 'Tickets ab 49,50 EUR. Fragen an tickets@kulturhaus-berlin.de oder +49 30 1234567.'
            expect(redactForModel(page)).toBe(page)
        })

        it('redacts a card number but not an order number of the same length', () => {
            expect(redactForModel('Karte 4111 1111 1111 1111')).toContain(REDACTED)
            expect(redactForModel('Bestellnummer 1234567812345678')).toBe('Bestellnummer 1234567812345678')
        })
    })

    describe('what the audit trail sees', () => {
        it('additionally removes personal data', () => {
            const line = 'Kontakt: anna@example.com, +49 30 1234567'
            const audited = redactForAudit(line)
            expect(audited).not.toContain('anna@example.com')
            expect(audited).not.toContain('1234567')
        })

        it('redacts a field by its NAME even when the value looks harmless', () => {
            const record = redactObjectForAudit({ password: 'abc', text: 'hello', title: 'Konzert' })
            expect(record.password).toBe(REDACTED)
            expect(record.text).toBe(REDACTED)
            expect(record.title).toBe('Konzert')
        })

        it('bounds strings, arrays and depth so one page cannot fill the record', () => {
            const record = redactObjectForAudit({ long: 'x'.repeat(5000), many: new Array(100).fill('a') })
            expect(record.long.length).toBeLessThanOrEqual(501)
            expect(record.many).toHaveLength(25)
        })
    })

    describe('URLs', () => {
        it('drops userinfo and masks credential-shaped query parameters', () => {
            const redacted = redactUrl('https://user:pw@example.com/login?token=abc123&city=berlin#frag')
            expect(redacted).not.toContain('user:pw')
            expect(redacted).not.toContain('abc123')
            expect(redacted).toContain('city=berlin')
            expect(redacted).toContain('/login')
        })

        it('survives a value that is not a URL at all', () => {
            expect(redactUrl('not a url')).toBe('not a url')
            expect(redactUrl('')).toBe('')
        })
    })

    describe('typed text', () => {
        it('never returns the text itself', () => {
            const described = describeTypedValue('hunter2-super-secret')
            expect(JSON.stringify(described)).not.toContain('hunter2')
            expect(described.length).toBe(20)
            expect(described.shape).toBe('word')
        })

        it('recognises a credential-shaped value', () => {
            expect(containsLikelySecret('ghp_abcdefghijklmnopqrstuvwxyz0123')).toBe(true)
            expect(containsLikelySecret('AKIAIOSFODNN7EXAMPLE')).toBe(true)
            expect(containsLikelySecret('a7Xk29Lm44Qp01Zr88Tt43Vv')).toBe(true)
        })

        it('does not mistake ordinary search input for a credential', () => {
            // A false positive here refuses a legitimate search, which is the failure that makes
            // people switch the protection off.
            expect(containsLikelySecret('Konzert Berlin September')).toBe(false)
            expect(containsLikelySecret('2026-09-15')).toBe(false)
            expect(containsLikelySecret('Wysk')).toBe(false)
            expect(containsLikelySecret('')).toBe(false)
        })
    })
})
