'use strict'

const { normalizeAllowlist } = require('./browserAllowlist')
const { buildApprovalSignature, classifyObservedTarget, evaluateBrowserAction } = require('./browserPolicy')

const allowlist = normalizeAllowlist(['tickets.example', 'shop.example', 'bank.example']).entries

function evaluate(overrides = {}) {
    return evaluateBrowserAction({
        allowlist,
        pageUrl: 'https://tickets.example/event/42',
        ...overrides,
    })
}

// The descriptor as the WORKER would report it: read out of the live DOM, never model-authored.
function observed(overrides = {}) {
    return {
        tagName: 'button',
        role: 'button',
        name: 'Mehr anzeigen',
        inputType: '',
        isSubmit: false,
        formMethod: '',
        formAction: '',
        submitLabels: [],
        formFieldNames: [],
        ...overrides,
    }
}

describe('browser policy', () => {
    describe('navigate', () => {
        it('allows an allowlisted page and refuses everything else', () => {
            expect(evaluate({ action: 'navigate', args: { url: 'https://tickets.example/event/42' } }).decision).toBe(
                'allow'
            )
            expect(evaluate({ action: 'navigate', args: { url: 'https://elsewhere.example/' } }).decision).toBe('deny')
        })

        it('pauses for a URL whose path IS the action', () => {
            const result = evaluate({ action: 'navigate', args: { url: 'https://shop.example/account/delete' } })
            expect(result.decision).toBe('requires_approval')
            expect(result.category).toBe('delete')
        })

        it('does not pause for an ordinary page that merely mentions a word', () => {
            expect(evaluate({ action: 'navigate', args: { url: 'https://shop.example/delivery' } }).decision).toBe(
                'allow'
            )
        })
    })

    describe('read-only actions', () => {
        it.each(['inspect', 'wait', 'screenshot'])('allows %s without an approval', action => {
            expect(evaluate({ action }).decision).toBe('allow')
        })
    })

    describe('the generic-click bypass', () => {
        it('pauses on a purchase button whatever the tool call says', () => {
            const result = evaluate({
                action: 'click',
                // The model's own arguments carry no intent at all — only a ref.
                args: { ref: 'e7' },
                target: observed({ name: 'Jetzt kostenpflichtig bestellen', isSubmit: true, formMethod: 'post' }),
            })
            expect(result.decision).toBe('requires_approval')
            expect(result.category).toBe('payment')
        })

        it.each([
            ['Sign in', 'login'],
            ['Anmelden', 'login'],
            ['Iniciar sesión', 'login'],
            ['Jetzt buchen', 'booking'],
            ['Book now', 'booking'],
            ['Reservar mesa', 'booking'],
            ['Zur Kasse', 'payment'],
            ['Buy now', 'payment'],
            ['Datei hochladen', 'file_upload'],
            ['Konto löschen', 'delete'],
            ['Buchung stornieren', 'delete'],
            ['Eliminar cuenta', 'delete'],
            ['Nachricht senden', 'external_message'],
        ])('classifies the button labelled "%s" as %s', (label, category) => {
            const result = evaluate({ action: 'click', args: { ref: 'e1' }, target: observed({ name: label }) })
            expect(result.decision).toBe('requires_approval')
            expect(result.category).toBe(category)
        })

        it('pauses on an icon-only button whose FORM gives it away', () => {
            const result = evaluate({
                action: 'click',
                args: { ref: 'e3' },
                target: observed({
                    name: '',
                    isSubmit: true,
                    formMethod: 'post',
                    formAction: 'https://shop.example/checkout/confirm',
                }),
            })
            expect(result.decision).toBe('requires_approval')
            expect(result.category).toBe('payment')
        })

        it('treats an unrecognised form submission as submit_publish rather than allowing it', () => {
            const result = evaluate({
                action: 'click',
                args: { ref: 'e4' },
                target: observed({ name: 'Weiter', isSubmit: true, formMethod: 'post' }),
            })
            expect(result.decision).toBe('requires_approval')
            expect(result.category).toBe('submit_publish')
        })

        it('still allows an ordinary link or filter click', () => {
            expect(
                evaluate({ action: 'click', args: { ref: 'e9' }, target: observed({ role: 'link', name: 'Programm' }) })
                    .decision
            ).toBe('allow')
        })

        it('refuses the action when the element could not be observed', () => {
            // No descriptor means no classification, and an unclassified click is the bypass.
            const result = evaluate({ action: 'click', args: { ref: 'e9' }, target: null })
            expect(result.decision).toBe('deny')
            expect(result.reason).toBe('no_session')
        })

        it('refuses a click on a page that is not on the allowlist', () => {
            const result = evaluate({
                action: 'click',
                args: { ref: 'e1' },
                pageUrl: 'https://elsewhere.example/',
                target: observed(),
            })
            expect(result.decision).toBe('deny')
            expect(result.reason).toBe('not_allowlisted')
        })
    })

    describe('typing', () => {
        it('allows a GET search submit — the carve-out the feature exists for', () => {
            const result = evaluate({
                action: 'type',
                args: { ref: 'e2', text: 'Konzert 15. September', submit: true },
                target: observed({
                    tagName: 'input',
                    inputType: 'search',
                    name: '',
                    fieldName: 'q',
                    formMethod: 'get',
                }),
            })
            expect(result.decision).toBe('allow')
            expect(result.categories).toEqual(['search_submit'])
        })

        it('does not extend the carve-out to a POST form', () => {
            const result = evaluate({
                action: 'type',
                args: { ref: 'e2', text: 'x', submit: true },
                target: observed({ tagName: 'input', fieldName: 'q', formMethod: 'post' }),
            })
            expect(result.decision).toBe('requires_approval')
        })

        it('does not extend the carve-out when a sensitive category also matched', () => {
            const result = evaluate({
                action: 'type',
                args: { ref: 'e2', text: 'x', submit: true },
                target: observed({
                    tagName: 'input',
                    fieldName: 'q',
                    formMethod: 'get',
                    submitLabels: ['Jetzt buchen'],
                }),
            })
            expect(result.decision).toBe('requires_approval')
            expect(result.category).toBe('booking')
        })

        it('can be configured to require an approval even for a search submit', () => {
            const result = evaluate({
                action: 'type',
                args: { ref: 'e2', text: 'x', submit: true },
                target: observed({ tagName: 'input', fieldName: 'q', formMethod: 'get' }),
                allowSearchSubmit: false,
            })
            expect(result.decision).toBe('requires_approval')
        })

        it('pauses on a password field', () => {
            const result = evaluate({
                action: 'type',
                args: { ref: 'e5', text: 'not-a-detected-secret' },
                target: observed({ tagName: 'input', inputType: 'password', name: 'Passwort' }),
            })
            expect(result.decision).toBe('requires_approval')
            expect(result.category).toBe('login')
        })

        it('REFUSES a credential typed into anything that is not a credential field', () => {
            const result = evaluate({
                action: 'type',
                args: { ref: 'e2', text: 'ghp_abcdefghijklmnopqrstuvwxyz0123' },
                target: observed({ tagName: 'input', fieldName: 'q', formMethod: 'get' }),
            })
            expect(result.decision).toBe('deny')
            expect(result.reason).toBe('secret_in_input')
        })

        it('allows typing without submitting into an ordinary field', () => {
            expect(
                evaluate({
                    action: 'type',
                    args: { ref: 'e2', text: 'Berlin' },
                    target: observed({ tagName: 'input', fieldName: 'city' }),
                }).decision
            ).toBe('allow')
        })
    })

    describe('approval signatures', () => {
        it('is stable for the same operation and different for another one', () => {
            const book = evaluate({
                action: 'click',
                args: { ref: 'e1' },
                target: observed({ name: 'Jetzt buchen' }),
            })
            const bookAgain = evaluate({
                action: 'click',
                args: { ref: 'e2' },
                target: observed({ name: 'Jetzt buchen' }),
            })
            const remove = evaluate({
                action: 'click',
                args: { ref: 'e1' },
                target: observed({ name: 'Konto löschen' }),
            })
            expect(book.signature).toBe(bookAgain.signature)
            expect(book.signature).not.toBe(remove.signature)
        })

        it('is different on a different host', () => {
            const here = buildApprovalSignature({
                action: 'click',
                category: 'booking',
                hostname: 'tickets.example',
                target: observed({ name: 'Jetzt buchen' }),
            })
            const there = buildApprovalSignature({
                action: 'click',
                category: 'booking',
                hostname: 'shop.example',
                target: observed({ name: 'Jetzt buchen' }),
            })
            expect(here).not.toBe(there)
        })
    })

    describe('classifyObservedTarget', () => {
        it('reports every category it saw, not just the first', () => {
            const { categories, evidence } = classifyObservedTarget(
                observed({ name: 'Jetzt kaufen', submitLabels: ['Anmelden'] }),
                'https://shop.example/checkout'
            )
            expect(categories).toEqual(expect.arrayContaining(['payment', 'login']))
            expect(evidence.length).toBeGreaterThan(0)
        })

        it('does not fire on a word that merely contains a keyword', () => {
            // "verkaufen" contains "kaufen"; "Postleitzahl" contains "post".
            const { categories } = classifyObservedTarget(observed({ name: 'Angebote verkaufen' }), '')
            expect(categories).not.toContain('payment')
        })
    })
})
