/**
 * Unit tests for the VM host-task title derivation used when execute_task_in_vm is invoked
 * outside any conversation and a fresh task must be created to host the job.
 */
const { buildVmJobTaskName, buildVmJobTaskDescription } = require('./vmHostTaskHelper')

describe('buildVmJobTaskName', () => {
    it('uses the objective as the title when short', () => {
        expect(buildVmJobTaskName('Build a landing page')).toBe('Build a landing page')
    })

    it('trims surrounding whitespace', () => {
        expect(buildVmJobTaskName('   Refactor the auth module   ')).toBe('Refactor the auth module')
    })

    it('uses only the first non-empty line', () => {
        expect(buildVmJobTaskName('Summarize the docs\nthen email the team')).toBe('Summarize the docs')
    })

    it('falls back to a default for empty/blank/non-string objectives', () => {
        expect(buildVmJobTaskName('')).toBe('VM task')
        expect(buildVmJobTaskName('    ')).toBe('VM task')
        expect(buildVmJobTaskName(undefined)).toBe('VM task')
        expect(buildVmJobTaskName(null)).toBe('VM task')
        expect(buildVmJobTaskName(42)).toBe('VM task')
    })

    it('caps very long titles with an ellipsis', () => {
        const longObjective = 'A'.repeat(200)
        const result = buildVmJobTaskName(longObjective)
        expect(result.length).toBe(120)
        expect(result.endsWith('…')).toBe(true)
    })

    it('does not append an ellipsis when exactly at the cap', () => {
        const exact = 'B'.repeat(120)
        const result = buildVmJobTaskName(exact)
        expect(result).toBe(exact)
        expect(result.endsWith('…')).toBe(false)
    })
})

describe('buildVmJobTaskDescription', () => {
    it('uses the objective alone when nothing else is provided', () => {
        expect(buildVmJobTaskDescription({ objective: 'Research competitors' })).toBe('Research competitors')
    })

    it('appends the deliverable when provided', () => {
        expect(buildVmJobTaskDescription({ objective: 'Research competitors', deliverable: 'a 1-page summary' })).toBe(
            'Research competitors\n\n**Deliverable:** a 1-page summary'
        )
    })

    it('appends the original request when it differs from the objective', () => {
        expect(
            buildVmJobTaskDescription({
                objective: 'Research the top 5 CRM tools and compare pricing',
                originatingRequestText: 'find me a good CRM',
            })
        ).toBe('Research the top 5 CRM tools and compare pricing\n\n**Original request:** find me a good CRM')
    })

    it('does not duplicate the request when it equals the objective', () => {
        expect(
            buildVmJobTaskDescription({ objective: 'Build a todo app', originatingRequestText: 'Build a todo app' })
        ).toBe('Build a todo app')
    })

    it('combines all parts in order', () => {
        expect(
            buildVmJobTaskDescription({
                objective: 'Build a landing page',
                deliverable: 'a single-file HTML page',
                originatingRequestText: 'make me a quick landing page',
            })
        ).toBe(
            'Build a landing page\n\n**Deliverable:** a single-file HTML page\n\n**Original request:** make me a quick landing page'
        )
    })

    it('returns an empty string when nothing usable is provided', () => {
        expect(buildVmJobTaskDescription({})).toBe('')
        expect(buildVmJobTaskDescription({ objective: '   ' })).toBe('')
        expect(buildVmJobTaskDescription()).toBe('')
    })
})
