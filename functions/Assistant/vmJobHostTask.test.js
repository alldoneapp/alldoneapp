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

describe('buildVmChatPath', () => {
    const { buildVmChatPath } = require('./vmHostTaskHelper')

    it('builds a task thread path', () => {
        expect(buildVmChatPath('p1', 'tasks', 't1')).toBe('/projects/p1/tasks/t1/chat')
    })

    it('maps topics to the chats segment', () => {
        expect(buildVmChatPath('p1', 'topics', 'c1')).toBe('/projects/p1/chats/c1/chat')
    })
})

describe('ensureVmHostThreadLinksInResponse', () => {
    const { ensureVmHostThreadLinksInResponse } = require('./vmHostTaskHelper')

    const startedJob = {
        success: true,
        hostProjectId: 'p1',
        hostObjectType: 'tasks',
        hostObjectId: 't1',
        hostThreadUrl: 'https://my.alldone.app/projects/p1/tasks/t1/chat',
    }

    it('appends the host thread link when the assistant omitted it', () => {
        expect(ensureVmHostThreadLinksInResponse('I started the VM task.', [startedJob])).toBe(
            'I started the VM task.\n\nFollow it here: https://my.alldone.app/projects/p1/tasks/t1/chat'
        )
    })

    it('leaves the response alone when the link is already present', () => {
        const text = `Started it: ${startedJob.hostThreadUrl}`
        expect(ensureVmHostThreadLinksInResponse(text, [startedJob])).toBe(text)
    })

    it('does not link the thread the user is already reading', () => {
        expect(
            ensureVmHostThreadLinksInResponse('Working on it.', [startedJob], { projectId: 'p1', objectId: 't1' })
        ).toBe('Working on it.')
    })

    it('still links a host thread that differs from the current one', () => {
        const result = ensureVmHostThreadLinksInResponse('Working on it.', [startedJob], {
            projectId: 'p1',
            objectId: 'some-other-thread',
        })
        expect(result).toContain(startedJob.hostThreadUrl)
    })

    it('ignores failed dispatches and results without host thread fields', () => {
        expect(ensureVmHostThreadLinksInResponse('Nope.', [{ ...startedJob, success: false }])).toBe('Nope.')
        expect(ensureVmHostThreadLinksInResponse('Nope.', [{ success: true, message: 'ok' }])).toBe('Nope.')
    })

    it('deduplicates repeated host threads and links distinct ones once each', () => {
        const other = { ...startedJob, hostObjectId: 't2', hostThreadUrl: 'https://my.alldone.app/x/t2' }
        const result = ensureVmHostThreadLinksInResponse('Done.', [startedJob, startedJob, other])
        expect(result.match(/Follow it here:/g)).toHaveLength(2)
    })

    it('returns just the link when there is no response text', () => {
        expect(ensureVmHostThreadLinksInResponse('', [startedJob])).toBe(`Follow it here: ${startedJob.hostThreadUrl}`)
    })
})
