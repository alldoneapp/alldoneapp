/**
 * AT-3096: the conversation that delegated work into a task always shows that task's canonical link.
 */
const {
    buildTaskChatUrl,
    buildDelegatedTaskHandoff,
    normalizeDelegatedTaskHandoff,
    withDelegatedTaskLink,
    collectDelegatedTaskHandoffs,
    ensureDelegatedTaskLinksInResponse,
} = require('./delegatedTaskLinks')
const { ensureVmHostThreadLinksInResponse } = require('./vmHostTaskHelper')

const BASE = 'https://my.alldone.app'
const PROJECT = '-M6X9vdIokG7HAammHGg'
const TASK = 'GVa54YBE9Ni8GdCZ3gXA'
const URL = `${BASE}/projects/${PROJECT}/tasks/${TASK}/chat`
const handoff = buildDelegatedTaskHandoff({ baseUrl: BASE, projectId: PROJECT, taskId: TASK })
const chat = { projectId: PROJECT, objectType: 'topics', objectId: '-P6ihDhYTpP-_qSpH24c' }

describe('buildTaskChatUrl', () => {
    it('builds the same task chat link the server notices use', () => {
        expect(buildTaskChatUrl(`${BASE}/`, PROJECT, TASK)).toBe(URL)
    })

    it('builds nothing from missing or malformed ids, so no placeholder link can be produced', () => {
        expect(buildTaskChatUrl(BASE, PROJECT, '')).toBe('')
        expect(buildTaskChatUrl(BASE, '', TASK)).toBe('')
        expect(buildTaskChatUrl('', PROJECT, TASK)).toBe('')
        expect(buildTaskChatUrl(BASE, PROJECT, 'a/b')).toBe('')
        expect(buildTaskChatUrl(BASE, PROJECT, undefined)).toBe('')
    })
})

describe('normalizeDelegatedTaskHandoff', () => {
    it('is idempotent', () => {
        expect(normalizeDelegatedTaskHandoff(normalizeDelegatedTaskHandoff(handoff))).toEqual(handoff)
    })

    it('refuses a url that is not the canonical link of its own ids', () => {
        expect(
            normalizeDelegatedTaskHandoff({ projectId: PROJECT, taskId: TASK, url: `${BASE}/projects/x/tasks/y/chat` })
        ).toBeNull()
        expect(
            normalizeDelegatedTaskHandoff({ projectId: PROJECT, taskId: TASK, url: `${BASE}/projects/<id>/tasks/<id>` })
        ).toBeNull()
        expect(normalizeDelegatedTaskHandoff(null)).toBeNull()
    })
})

describe('withDelegatedTaskLink', () => {
    it('adds taskUrl and the delegated task reference to a successful result', () => {
        const result = withDelegatedTaskLink(
            { success: true, projectId: PROJECT, taskId: TASK, status: 'workflow_managed', message: 'm' },
            { baseUrl: BASE }
        )
        expect(result).toMatchObject({ status: 'workflow_managed', message: 'm', taskUrl: URL })
        expect(result.delegatedTask).toEqual(handoff)
    })

    it('carries a known human-readable id from the task', () => {
        const result = withDelegatedTaskLink(
            { success: true, projectId: PROJECT, taskId: TASK, task: { humanReadableId: 'AT-3095' } },
            { baseUrl: BASE }
        )
        expect(result.delegatedTask.humanReadableId).toBe('AT-3095')
    })

    it('leaves failed or incomplete results unchanged', () => {
        const failed = { success: false, projectId: PROJECT, taskId: TASK }
        expect(withDelegatedTaskLink(failed, { baseUrl: BASE })).toBe(failed)
        const incomplete = { success: true, projectId: PROJECT }
        expect(withDelegatedTaskLink(incomplete, { baseUrl: BASE })).toBe(incomplete)
    })
})

describe('collectDelegatedTaskHandoffs', () => {
    it('collects the tool result and a delegate assistant’s tasks once each', () => {
        const other = buildDelegatedTaskHandoff({ baseUrl: BASE, projectId: PROJECT, taskId: 'other' })
        const collected = []
        collectDelegatedTaskHandoffs(collected, { success: true, delegatedTask: handoff })
        collectDelegatedTaskHandoffs(collected, { success: true, delegatedTaskResults: [handoff, other] })
        collectDelegatedTaskHandoffs(collected, { success: false, delegatedTask: other })
        collectDelegatedTaskHandoffs(collected, { success: true, taskId: TASK })
        expect(collected).toEqual([handoff, other])
    })
})

describe('ensureDelegatedTaskLinksInResponse', () => {
    it('appends the link to a hand-off reply that only names the task (the AT-3095 reply)', () => {
        const reply = 'Die Umsetzung läuft in **AT-3095** weiter.'
        expect(ensureDelegatedTaskLinksInResponse(reply, [handoff], chat, { language: 'de' })).toBe(
            `${reply}\n\nHier geht es weiter: ${URL}`
        )
    })

    it('uses English by default and names a known human-readable id', () => {
        expect(ensureDelegatedTaskLinksInResponse('Started.', [{ ...handoff, humanReadableId: 'AT-1' }], chat)).toBe(
            `Started.\n\nFollow AT-1 here: ${URL}`
        )
    })

    it('does not duplicate a link the model already wrote', () => {
        const reply = `Läuft weiter in [AT-3095](${URL}).`
        expect(ensureDelegatedTaskLinksInResponse(reply, [handoff, handoff], chat, { language: 'de' })).toBe(reply)
    })

    it('rewrites a wrong or partial link of the same task to the canonical one instead of adding a second', () => {
        const reply = `See https://my.alldone.app/projects/wrong/tasks/${TASK}. Or [here](https://my.alldone.app/tasks/${TASK}).`
        expect(ensureDelegatedTaskLinksInResponse(reply, [handoff], chat)).toBe(`See ${URL}. Or [here](${URL}).`)
    })

    it('leaves links of other tasks and other URLs alone', () => {
        const reply = `Compare ${BASE}/projects/${PROJECT}/tasks/someOtherTask/chat and https://example.com/tasks`
        expect(ensureDelegatedTaskLinksInResponse(reply, [handoff], chat)).toBe(`${reply}\n\nFollow it here: ${URL}`)
    })

    it('adds no link when the reply is written in that task’s own chat', () => {
        const inTask = { projectId: PROJECT, objectType: 'tasks', objectId: TASK }
        expect(ensureDelegatedTaskLinksInResponse('Running.', [handoff], inTask)).toBe('Running.')
    })

    it('adds the link to an empty reply and ignores malformed references', () => {
        expect(ensureDelegatedTaskLinksInResponse('', [handoff, { taskId: 'x' }], chat)).toBe(`Follow it here: ${URL}`)
        expect(ensureDelegatedTaskLinksInResponse('Hi', [], chat)).toBe('Hi')
    })

    it('does not add a second line after the VM host link of the same task', () => {
        const vmJob = { hostProjectId: PROJECT, hostObjectId: TASK, hostObjectType: 'tasks', hostThreadUrl: URL }
        const withVm = ensureVmHostThreadLinksInResponse('Started.', [vmJob], chat, { language: 'de' })
        expect(withVm).toBe(`Started.\n\nHier geht es weiter: ${URL}`)
        expect(ensureDelegatedTaskLinksInResponse(withVm, [handoff], chat, { language: 'de' })).toBe(withVm)
    })
})

describe('wiring in assistantHelper (source ratchet)', () => {
    const source = require('fs').readFileSync(require('path').join(__dirname, 'assistantHelper.js'), 'utf8')

    it('imports what the talk_to_assistant runtime uses to forward a tracked origin', () => {
        const importBlock = source.match(/const \{([^}]*)\} = require\('\.\/annaTaskDelegation'\)/)
        expect(importBlock).not.toBeNull()
        expect(importBlock[1]).toContain('isTrackedOriginConversation')
        expect(source).toContain('originTracksWork: isTrackedOriginConversation(callerToolRuntimeContext)')
    })

    it('links delegated tasks on both assistant run paths and passes a delegate’s tasks on', () => {
        expect(source.match(/collectDelegatedTaskHandoffs\(delegatedTaskResults, toolResult\)/g)).toHaveLength(2)
        expect(source.match(/ensureDelegatedTaskLinksInResponse\(/g)).toHaveLength(2)
        expect(source).toContain('delegatedTaskResults: Array.isArray(delegationRun?.delegatedTaskResults)')
    })
})
