const {
    buildContactUpdatesFromToolArgs,
    describeContactForPrompt,
    normalizeLinkedInUrl,
} = require('./contactEnrichmentFields')

describe('buildContactUpdatesFromToolArgs', () => {
    test('maps the enrichment fields and writes the description to both description fields', () => {
        const result = buildContactUpdatesFromToolArgs({
            displayName: '  anna   somova ',
            company: 'Example GmbH',
            role: 'CTO',
            phone: '+49 30 1234',
            description: 'Anna leads engineering at Example.\n\n\n\nShe joined in 2019.',
            linkedInUrl: 'www.linkedin.com/in/anna-somova/?utm_source=x',
        })
        expect(result.errors).toEqual([])
        expect(result.updates).toEqual({
            displayName: 'anna somova',
            company: 'Example GmbH',
            role: 'CTO',
            phone: '+49 30 1234',
            description: 'Anna leads engineering at Example.\n\nShe joined in 2019.',
            extendedDescription: 'Anna leads engineering at Example.\n\nShe joined in 2019.',
            linkedInUrl: 'https://www.linkedin.com/in/anna-somova',
        })
        expect(result.photoUrl).toBeNull()
    })

    test('only carries the fields that were passed', () => {
        const result = buildContactUpdatesFromToolArgs({ company: 'Example' })
        expect(result.updates).toEqual({ company: 'Example' })
    })

    test('an empty string clears a field, except the name', () => {
        expect(buildContactUpdatesFromToolArgs({ role: '' }).updates).toEqual({ role: '' })
        const result = buildContactUpdatesFromToolArgs({ displayName: '   ' })
        expect(result.updates).toEqual({})
        expect(result.errors).toEqual(['displayName cannot be emptied.'])
    })

    test('rejects a LinkedIn URL that is not a profile', () => {
        const result = buildContactUpdatesFromToolArgs({ linkedInUrl: 'https://www.linkedin.com/company/example' })
        expect(result.updates).toEqual({})
        expect(result.errors[0]).toMatch(/linkedInUrl must be a LinkedIn profile URL/)
    })

    test('separates the photo from the document fields and validates it', () => {
        expect(buildContactUpdatesFromToolArgs({ photoUrl: 'https://cdn.example.com/anna.jpg' })).toMatchObject({
            updates: {},
            photoUrl: 'https://cdn.example.com/anna.jpg',
            clearPhoto: false,
        })
        expect(buildContactUpdatesFromToolArgs({ photoUrl: '' })).toMatchObject({ photoUrl: null, clearPhoto: true })
        expect(buildContactUpdatesFromToolArgs({ photoUrl: 'data:image/png;base64,xxx' }).errors[0]).toMatch(/photoUrl/)
    })

    test('caps overlong values instead of failing the whole update', () => {
        const result = buildContactUpdatesFromToolArgs({ role: 'x'.repeat(500) })
        expect(result.updates.role).toHaveLength(160)
        expect(result.errors).toEqual([])
    })
})

describe('normalizeLinkedInUrl', () => {
    test('keeps the profile path, drops tracking and the trailing slash', () => {
        expect(normalizeLinkedInUrl('https://de.linkedin.com/in/anna-somova-1a2b/?trk=public').value).toBe(
            'https://de.linkedin.com/in/anna-somova-1a2b'
        )
    })
})

describe('describeContactForPrompt', () => {
    test('renders every field the prompt needs, marking empties explicitly', () => {
        const text = describeContactForPrompt({
            displayName: 'Anna Somova',
            company: '',
            emails: ['anna@example.com', 'a@x.io'],
            photoURL: 'https://storage/x',
            extendedDescription: 'CTO at Example',
        })
        expect(text).toContain('- Name: Anna Somova')
        expect(text).toContain('- Company: (empty)')
        expect(text).toContain('- Email: anna@example.com, a@x.io')
        expect(text).toContain('- LinkedIn: (empty)')
        expect(text).toContain('- Description: CTO at Example')
        expect(text).toContain('- Photo: set')
    })
})
