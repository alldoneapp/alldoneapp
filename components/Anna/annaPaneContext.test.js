jest.mock('../../utils/backends/firestore', () => ({ runHttpsCallableFunction: jest.fn() }))

import { buildAnnaPaneContext } from './annaPaneContext'
import { clearAppModelContext, getAppModelContext, setAppModelContext } from '../../utils/annaAppModelContext'

const page = { path: '/projects/tasks/open', title: 'All projects - Open tasks' }
const base = { active: true, visibleWorkspace: true, surface: 'alldone', page }
const storyBuilder = {
    kind: 'iframe',
    viewId: 'iframe:https://alldone.team/story-builder',
    url: 'https://alldone.team/story-builder?embed=1',
    appName: 'Story Builder',
}
const judy = {
    viewId: 'v1',
    appName: 'Judy Job',
    serverId: 'srv1',
    serverLabel: 'alldone.team',
    serverUrl: 'https://alldone.team/mcp',
    toolName: 'judy_show',
}
const vmThread = {
    id: 'p1__t1',
    runId: 'run1',
    projectId: 'p1',
    objectType: 'tasks',
    objectId: 't1',
    title: 'Fix the login',
    status: 'awaiting_user',
    model: 'opus',
    waitingCount: 0,
}

describe('AT-2955: the context the assistant shell publishes for its work pane', () => {
    test('an Alldone page stays an Alldone page', () => {
        expect(buildAnnaPaneContext(base)).toEqual({ ...page, surface: 'alldone' })
    })

    test('an app in the pane names the app, never the hidden Alldone page behind it', () => {
        const context = buildAnnaPaneContext({
            ...base,
            surface: `app:${storyBuilder.viewId}`,
            selectedAppView: storyBuilder,
        })
        expect(context).toEqual({
            path: '/',
            title: 'Story Builder',
            surface: 'app',
            app: { kind: 'iframe', name: 'Story Builder', origin: 'https://alldone.team' },
        })
        expect(JSON.stringify(context)).not.toContain('Open tasks')
    })

    test('an MCP Apps view carries its server and tool, and the state it reported', () => {
        const context = buildAnnaPaneContext({
            ...base,
            surface: 'app:v1',
            selectedAppView: judy,
            appState: { text: 'Matches for Berlin', updatedAt: 5 },
        })
        expect(context.app).toEqual({
            kind: 'mcp',
            name: 'Judy Job',
            serverId: 'srv1',
            serverLabel: 'alldone.team',
            toolName: 'judy_show',
            serverHost: 'alldone.team',
            state: { text: 'Matches for Berlin', updatedAt: 5 },
        })
    })

    test('a VM names its run, task and status; the overview and the browser are named too', () => {
        expect(buildAnnaPaneContext({ ...base, surface: 'vm:p1__t1', selectedVm: vmThread })).toEqual({
            path: '/projects/p1/tasks/t1/chat',
            title: 'Fix the login',
            surface: 'vm',
            vm: {
                runId: 'run1',
                projectId: 'p1',
                objectType: 'tasks',
                objectId: 't1',
                title: 'Fix the login',
                status: 'awaiting_user',
                model: 'opus',
                waitingCount: 0,
            },
        })
        expect(buildAnnaPaneContext({ ...base, surface: 'vms', vmCount: 2 })).toMatchObject({
            surface: 'vms',
            vmCount: 2,
        })
        expect(buildAnnaPaneContext({ ...base, surface: 'browser' })).toEqual({
            path: '/',
            title: 'Browser',
            surface: 'browser',
        })
    })

    test('chat only shows no work surface; outside assistant mode the page is used', () => {
        expect(buildAnnaPaneContext({ ...base, visibleWorkspace: false, selectedAppView: judy })).toEqual({
            path: '/',
            title: 'Anna',
            surface: 'none',
        })
        expect(buildAnnaPaneContext({ ...base, active: false, selectedAppView: judy })).toEqual({
            ...page,
            surface: 'alldone',
        })
    })
})

describe('app-reported state store', () => {
    test('sanitizes, replaces, and clears per view', () => {
        expect(setAppModelContext('v1', { content: [{ type: 'text', text: 'Scene 3 of 25' }] })).toBe(true)
        expect(getAppModelContext('v1')).toMatchObject({ text: 'Scene 3 of 25' })
        setAppModelContext('v1', { structuredContent: { scene: 4 } })
        expect(getAppModelContext('v1').text).toBe('{"scene":4}')
        // An empty update clears, as each MCP Apps update replaces the previous one.
        expect(setAppModelContext('v1', { content: [] })).toBe(false)
        expect(getAppModelContext('v1')).toBeNull()
        setAppModelContext('v1', { text: 'x' })
        clearAppModelContext('v1')
        expect(getAppModelContext('v1')).toBeNull()
        expect(setAppModelContext('', { text: 'x' })).toBe(false)
    })
})
