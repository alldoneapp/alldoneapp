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
    removeCurrentThreadLinks,
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

// AT-3096 follow-up (2026-11-18): in the chat of task Q2XA2dxekAsf9QjI24yS (AT-3093) the user asked to
// retry; execute_task_in_vm joined that same delegated task and its result carried `taskUrl`, so the
// reply said "The result will appear here: <link to this very task>".
describe('the conversation the work continues in gets no link to itself', () => {
    const REPORTED_TASK = 'Q2XA2dxekAsf9QjI24yS'
    const SELF_URL = `${BASE}/projects/${PROJECT}/tasks/${REPORTED_TASK}/chat`
    const inReportedTask = { projectId: PROJECT, objectType: 'tasks', objectId: REPORTED_TASK }
    const reportedReply =
        'The retry is queued through the task’s workflow: push the existing branch and open the MR in the ' +
        'foreground—no merge or deployment. The result will appear here:\n\n' +
        SELF_URL
    const managed = { success: true, projectId: PROJECT, taskId: REPORTED_TASK, status: 'workflow_managed' }

    it('a tool result for the current task carries no URL the model could pass on', () => {
        const result = withDelegatedTaskLink(managed, { baseUrl: BASE, currentThread: inReportedTask })
        expect(result.taskUrl).toBeUndefined()
        expect(JSON.stringify(result)).not.toContain('/chat')
        expect(result).toMatchObject({
            continuesInCurrentConversation: true,
            delegatedTask: { projectId: PROJECT, taskId: REPORTED_TASK, currentConversation: true },
        })
        expect(result.linkInstruction).toMatch(/Do not link this task/)
    })

    it('drops a taskUrl the result already had', () => {
        const result = withDelegatedTaskLink(
            { ...managed, taskUrl: SELF_URL },
            { baseUrl: BASE, currentThread: inReportedTask }
        )
        expect(result.taskUrl).toBeUndefined()
    })

    it('still links a different task, and the same task from a chat or another project', () => {
        const other = withDelegatedTaskLink(
            { ...managed, taskId: TASK },
            { baseUrl: BASE, currentThread: inReportedTask }
        )
        expect(other.taskUrl).toBe(URL)
        expect(withDelegatedTaskLink(managed, { baseUrl: BASE, currentThread: chat }).taskUrl).toBe(SELF_URL)
        const sameIdAsChat = { ...chat, objectId: REPORTED_TASK }
        expect(withDelegatedTaskLink(managed, { baseUrl: BASE, currentThread: sameIdAsChat }).taskUrl).toBe(SELF_URL)
        const otherProject = { ...inReportedTask, projectId: 'another-project' }
        expect(withDelegatedTaskLink(managed, { baseUrl: BASE, currentThread: otherProject }).taskUrl).toBe(SELF_URL)
        // A delegate without a conversation of its own keeps the link; its caller decides.
        expect(withDelegatedTaskLink(managed, { baseUrl: BASE }).taskUrl).toBe(SELF_URL)
    })

    it('keeps the current-conversation marker through normalize and collect, without a URL', () => {
        const { delegatedTask } = withDelegatedTaskLink(managed, { baseUrl: BASE, currentThread: inReportedTask })
        expect(normalizeDelegatedTaskHandoff(normalizeDelegatedTaskHandoff(delegatedTask))).toEqual(delegatedTask)
        expect(normalizeDelegatedTaskHandoff({ ...delegatedTask, url: 'https://evil.example/x' })).toEqual(
            delegatedTask
        )
        expect(collectDelegatedTaskHandoffs([], { success: true, delegatedTask })).toEqual([delegatedTask])
    })

    it('removes the link the model wrote to the task it is replying in (the reported reply)', () => {
        const marker = { projectId: PROJECT, taskId: REPORTED_TASK, currentConversation: true }
        expect(ensureDelegatedTaskLinksInResponse(reportedReply, [marker], inReportedTask)).toBe(
            'The retry is queued through the task’s workflow: push the existing branch and open the MR in the ' +
                'foreground—no merge or deployment. The result will appear here.'
        )
        // Also when the hand-off reference still has its URL (a delegate joined the caller's task).
        const fromDelegate = buildDelegatedTaskHandoff({ baseUrl: BASE, projectId: PROJECT, taskId: REPORTED_TASK })
        expect(ensureDelegatedTaskLinksInResponse(reportedReply, [fromDelegate], inReportedTask)).not.toContain(
            SELF_URL
        )
    })

    it('keeps a link to a different execution task in the same reply, and still adds its own', () => {
        const marker = { projectId: PROJECT, taskId: REPORTED_TASK, currentConversation: true }
        const reply = `Waiting here: ${SELF_URL}\nThe fix itself runs in ${URL}`
        expect(ensureDelegatedTaskLinksInResponse(reply, [marker, handoff], inReportedTask)).toBe(
            `Waiting here.\nThe fix itself runs in ${URL}`
        )
        expect(
            ensureDelegatedTaskLinksInResponse('Queued.', [marker, handoff], inReportedTask, { language: 'de' })
        ).toBe(`Queued.\n\nHier geht es weiter: ${URL}`)
    })

    it('a marker from another conversation neither links nor strips anything', () => {
        const marker = { projectId: PROJECT, taskId: REPORTED_TASK, currentConversation: true }
        const reply = `Status: ${SELF_URL}`
        expect(ensureDelegatedTaskLinksInResponse(reply, [marker], chat)).toBe(reply)
        expect(ensureDelegatedTaskLinksInResponse('Queued.', [marker], chat)).toBe('Queued.')
    })

    it('leaves a self-link alone when the run handed nothing to this task', () => {
        // E.g. the user asked "what is the link of this task?": no hand-off, nothing removed.
        const reply = `Here it is: ${SELF_URL}`
        expect(ensureDelegatedTaskLinksInResponse(reply, [handoff], inReportedTask)).toBe(
            `${reply}\n\nFollow it here: ${URL}`
        )
    })
})

describe('removeCurrentThreadLinks', () => {
    const thread = { projectId: PROJECT, objectType: 'tasks', objectId: TASK }
    const strip = text => removeCurrentThreadLinks(text, thread)

    it('tidies what the removed link leaves behind', () => {
        expect(strip(`Läuft weiter: ${URL}`)).toBe('Läuft weiter.')
        expect(strip(`Follow it in AT-3093 (${URL}).`)).toBe('Follow it in AT-3093.')
        expect(strip(`See [this task](${URL}) for updates.`)).toBe('See this task for updates.')
        expect(strip(`Link: <${URL}>\n\nNext steps:\n- a`)).toBe('Link.\n\nNext steps:\n- a')
        expect(strip(`Done.\n\n**${URL}**\n\nBye.`)).toBe('Done.\n\nBye.')
        expect(strip(`- Task: ${URL}\n- Other: ${BASE}/projects/${PROJECT}/tasks/other/chat`)).toBe(
            `- Task.\n- Other: ${BASE}/projects/${PROJECT}/tasks/other/chat`
        )
    })

    it('matches the task in any project form and leaves every other link and colon alone', () => {
        expect(strip(`a ${BASE}/projects/wrong/tasks/${TASK} b`)).toBe('a b')
        const untouched = `Steps:\n\n- one\n\nSee https://example.com/tasks/${TASK}x and ${BASE}/projects/${PROJECT}/tasks/other`
        expect(strip(untouched)).toBe(untouched)
    })

    it('handles a topic chat by its chats route', () => {
        const topic = { projectId: PROJECT, objectType: 'topics', objectId: 'chat-1' }
        expect(removeCurrentThreadLinks(`Here: ${BASE}/projects/${PROJECT}/chats/chat-1/chat`, topic)).toBe('Here.')
        expect(removeCurrentThreadLinks(`Task: ${URL}`, topic)).toBe(`Task: ${URL}`)
    })
})

describe('ensureVmHostThreadLinksInResponse with a VM in the current thread', () => {
    const vmJob = { hostProjectId: PROJECT, hostObjectId: TASK, hostObjectType: 'tasks', hostThreadUrl: URL }
    const inTask = { projectId: PROJECT, objectType: 'tasks', objectId: TASK }

    it('removes the host link the model copied from the start result', () => {
        expect(ensureVmHostThreadLinksInResponse(`VM started. The work lives here: ${URL}`, [vmJob], inTask)).toBe(
            'VM started. The work lives here.'
        )
    })

    it('still links a VM hosted in another thread', () => {
        expect(ensureVmHostThreadLinksInResponse('VM started.', [vmJob], chat)).toBe(
            `VM started.\n\nFollow it here: ${URL}`
        )
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
        // Every execute_task_in_vm hand-off knows the conversation it answers in (AT-3096 follow-up).
        expect(source.match(/withDelegatedTaskLink\(/g)).toHaveLength(4)
        expect(source.match(/currentThread: currentVmCallerThread/g)).toHaveLength(3)
        expect(source).toContain('callerThread: currentVmCallerThread,')
        expect(source).toContain('delegatedTaskResults: Array.isArray(delegationRun?.delegatedTaskResults)')
    })
})
