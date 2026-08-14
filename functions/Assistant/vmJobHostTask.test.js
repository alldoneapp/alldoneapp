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

describe('startsVmJobInCurrentThread', () => {
    const { startsVmJobInCurrentThread } = require('./vmHostTaskHelper')

    const startedJob = {
        success: true,
        hostProjectId: 'p1',
        hostObjectType: 'tasks',
        hostObjectId: 't1',
        hostThreadUrl: 'https://my.alldone.app/projects/p1/tasks/t1/chat',
    }
    const currentThread = { projectId: 'p1', objectId: 't1' }

    it('detects a VM job hosted in the thread the assistant is replying in', () => {
        expect(startsVmJobInCurrentThread([startedJob], currentThread)).toBe(true)
    })

    it('detects it among several started jobs', () => {
        const elsewhere = { ...startedJob, hostObjectId: 't2', hostThreadUrl: 'https://my.alldone.app/x/t2' }
        expect(startsVmJobInCurrentThread([elsewhere, startedJob], currentThread)).toBe(true)
    })

    // Delegation and contextless triggers host the job in another task, whose result never reaches
    // this conversation — so the hand-off reply is all the user gets here and must still notify.
    it('ignores a job hosted in another thread or another project', () => {
        expect(startsVmJobInCurrentThread([startedJob], { projectId: 'p1', objectId: 'other-thread' })).toBe(false)
        expect(startsVmJobInCurrentThread([startedJob], { projectId: 'other-project', objectId: 't1' })).toBe(false)
    })

    it('ignores failed dispatches and results without host thread fields', () => {
        expect(startsVmJobInCurrentThread([{ ...startedJob, success: false }], currentThread)).toBe(false)
        expect(startsVmJobInCurrentThread([{ success: true, message: 'ok' }], currentThread)).toBe(false)
    })

    it('is false when nothing was started or the thread is unknown', () => {
        expect(startsVmJobInCurrentThread([], currentThread)).toBe(false)
        expect(startsVmJobInCurrentThread(undefined, currentThread)).toBe(false)
        expect(startsVmJobInCurrentThread([startedJob], null)).toBe(false)
        expect(startsVmJobInCurrentThread([startedJob], { projectId: 'p1' })).toBe(false)
    })
})

// The production regression. Everything above feeds the helpers a RAW execute_task_in_vm tool
// result, which is NOT what the assistant run holds: it collects the NORMALIZED job and passes
// that list on. normalizeStartedVmJob renames hostObjectId -> objectId / hostThreadUrl -> url, so
// a second pass over an already-normalized job returned null — silently turning the in-thread
// hand-off guard (and the link safety net) off for every VM start. These tests exercise the real
// collect-then-consume round trip.
describe('started VM job round trip (collect -> consume)', () => {
    const {
        collectStartedVmJobs,
        normalizeStartedVmJob,
        startsVmJobInCurrentThread,
        ensureVmHostThreadLinksInResponse,
        VM_JOB_TOOL_NAME,
    } = require('./vmHostTaskHelper')

    // Exactly the shape startVmJob returns on a successful in-thread dispatch.
    const startVmJobResult = (overrides = {}) => ({
        success: true,
        status: 'started',
        correlationId: 'corr-1',
        agent: 'claude',
        credentialMode: 'api',
        hostProjectId: 'p1',
        hostObjectType: 'tasks',
        hostObjectId: 't1',
        hostThreadUrl: 'https://my.alldone.app/projects/p1/tasks/t1/chat',
        message: 'VM task started with Claude.',
        ...overrides,
    })
    const currentThread = { projectId: 'p1', objectId: 't1' }

    it('normalizes idempotently — a normalized job survives another pass', () => {
        const once = normalizeStartedVmJob(startVmJobResult())
        expect(once).toEqual({
            objectId: 't1',
            objectType: 'tasks',
            projectId: 'p1',
            url: 'https://my.alldone.app/projects/p1/tasks/t1/chat',
        })
        expect(normalizeStartedVmJob(once)).toEqual(once)
        expect(normalizeStartedVmJob(normalizeStartedVmJob(once))).toEqual(once)
    })

    it('suppresses the hand-off notification for a VM started in the current thread', () => {
        const collected = []
        collectStartedVmJobs(collected, VM_JOB_TOOL_NAME, startVmJobResult())

        expect(collected).toHaveLength(1)
        expect(startsVmJobInCurrentThread(collected, currentThread)).toBe(true)
    })

    it('still notifies for a VM hosted in another thread, and links it', () => {
        const collected = []
        collectStartedVmJobs(
            collected,
            VM_JOB_TOOL_NAME,
            startVmJobResult({ hostObjectId: 't2', hostThreadUrl: 'https://my.alldone.app/projects/p1/tasks/t2/chat' })
        )

        expect(startsVmJobInCurrentThread(collected, currentThread)).toBe(false)
        expect(ensureVmHostThreadLinksInResponse('Started it.', collected, currentThread)).toBe(
            'Started it.\n\nFollow it here: https://my.alldone.app/projects/p1/tasks/t2/chat'
        )
    })

    it('does not link the thread the user is already reading', () => {
        const collected = []
        collectStartedVmJobs(collected, VM_JOB_TOOL_NAME, startVmJobResult())
        expect(ensureVmHostThreadLinksInResponse('Started it.', collected, currentThread)).toBe('Started it.')
    })

    it('treats a queued same-thread follow-up as a hand-off too', () => {
        const collected = []
        collectStartedVmJobs(collected, VM_JOB_TOOL_NAME, startVmJobResult({ status: 'queued' }))
        expect(startsVmJobInCurrentThread(collected, currentThread)).toBe(true)
    })

    it('picks up a VM a delegated assistant started in this thread', () => {
        const collected = []
        // talk_to_assistant_* result: the delegate reports the jobs it started (already normalized
        // by its own collector).
        collectStartedVmJobs(collected, 'talk_to_assistant_cto', {
            success: true,
            assistantResponse: 'Handed to the VM.',
            startedVmJobResults: [normalizeStartedVmJob(startVmJobResult())],
        })

        expect(collected).toHaveLength(1)
        expect(startsVmJobInCurrentThread(collected, currentThread)).toBe(true)
    })

    it('ignores failed dispatches and unrelated tool results', () => {
        const collected = []
        collectStartedVmJobs(collected, VM_JOB_TOOL_NAME, { success: false, message: 'Not enough Gold.' })
        collectStartedVmJobs(collected, 'create_task', { success: true, taskId: 't9', projectId: 'p1' })
        collectStartedVmJobs(collected, VM_JOB_TOOL_NAME, null)

        expect(collected).toEqual([])
        expect(startsVmJobInCurrentThread(collected, currentThread)).toBe(false)
    })

    it('deduplicates repeated dispatches to the same host thread', () => {
        const collected = []
        collectStartedVmJobs(collected, VM_JOB_TOOL_NAME, startVmJobResult())
        collectStartedVmJobs(collected, VM_JOB_TOOL_NAME, startVmJobResult({ correlationId: 'corr-2' }))
        expect(collected).toHaveLength(1)
    })
})

// The previous fix was correct in the helper and wrong at the call site, and nothing failed. Keep
// the collection funnelled through the shared helper so the two sides cannot drift again.
describe('assistantHelper wires VM job collection through the shared helper', () => {
    const fs = require('fs')
    const path = require('path')
    const source = fs.readFileSync(path.join(__dirname, 'assistantHelper.js'), 'utf8')

    it('collects started VM jobs only via collectStartedVmJobs', () => {
        const collectCalls = source.match(/collectStartedVmJobs\(startedVmJobResults, toolName, toolResult\)/g) || []
        // One per assistant run path: the streaming chat run (storeChunks) and the non-streaming
        // collector (collectAssistantTextWithToolCalls).
        expect(collectCalls).toHaveLength(2)
        expect(source).not.toMatch(/normalizeStartedVmJob\(/)
    })

    it('asks the shared predicate whether the reply is an in-thread VM hand-off', () => {
        expect(source).toMatch(/startsVmJobInCurrentThread\(startedVmJobResults, \{ projectId, objectId \}\)/)
    })
})
