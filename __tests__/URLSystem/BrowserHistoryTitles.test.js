jest.mock('../../redux/store', () => ({ getState: () => ({ lastVisitedScreen: [] }), dispatch: jest.fn() }))
jest.mock('../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    getProjectNameById: () => 'Product',
    getUserNameById: () => 'Karsten',
    getContactNameById: () => 'Karl',
}))
jest.mock('../../utils/HelperFunctions', () => ({ getFirstName: value => value }))
jest.mock('../../components/Workstreams/WorkstreamHelper', () => ({
    DEFAULT_WORKSTREAM_ID: 'ws@default',
    WORKSTREAM_ID_PREFIX: 'ws@',
    getWorkstreamById: jest.fn(),
}))
jest.mock('../../components/AdminPanel/Assistants/assistantsHelper', () => ({
    getAssistant: jest.fn(),
    GLOBAL_PROJECT_ID: 'global',
}))

import URLSystem from '../../URLSystem/URLSystem'
import URLsNotes from '../../URLSystem/Notes/URLsNotes'
import URLsTasks from '../../URLSystem/Tasks/URLsTasks'
import URLsGoals from '../../URLSystem/Goals/URLsGoals'
import URLsChats from '../../URLSystem/Chats/URLsChats'
import URLsContacts from '../../URLSystem/Contacts/URLsContacts'
import URLsPeople from '../../URLSystem/People/URLsPeople'
import URLsSkills from '../../URLSystem/Skills/URLsSkills'
import URLsProjects from '../../URLSystem/Projects/URLsProjects'
import URLsSettings from '../../URLSystem/Settings/URLsSettings'
import URLsAdminPanel from '../../URLSystem/AdminPanel/URLsAdminPanel'
import URLsAssistants from '../../URLSystem/Assistants/URLsAssistants'

const routes = [
    [URLSystem, 'FEEDS_FOLLOWED', []],
    [URLsNotes, 'NOTE_DETAILS_EDITOR', ['p1', 'n1', 'Workflow Feature']],
    [URLsTasks, 'TASK_DETAILS_CHAT', ['p1', 't1']],
    [URLsGoals, 'GOAL_DETAILS', ['p1', 'g1']],
    [URLsChats, 'CHAT_DETAILS', ['p1', 'c1']],
    [URLsContacts, 'CONTACT_DETAILS', ['p1', 'c1']],
    [URLsPeople, 'PEOPLE_DETAILS', ['p1', 'u1']],
    [URLsSkills, 'SKILL_DETAILS', ['p1', 's1']],
    [URLsProjects, 'PROJECT_DETAILS', ['p1']],
    [URLsSettings, 'SETTINGS_PROFILE', []],
    [URLsAdminPanel, 'ADMIN_PANEL_USER', []],
    [URLsAssistants, 'ASSISTANT_DETAILS', ['global', 'a1']],
]

describe('AT-2719 browser title/URL pairing', () => {
    beforeEach(() => {
        window.history.replaceState(null, '', '/projects/tasks/open')
        document.title = 'Task list'
    })
    afterEach(() => jest.restoreAllMocks())

    it.each(routes)('%p changes the URL before setting a destination title', async (router, route, params) => {
        const original = router.setTitle
        const titleSpy = jest.spyOn(router, 'setTitle').mockImplementation((...args) => {
            expect(window.location.pathname).toBe(`/${router.getPath(route, ...params)}`)
            return original(...args)
        })
        for (const method of ['push', 'replace']) {
            router[method](route, { object: params[1] }, ...params)
            await Promise.resolve()
            expect(titleSpy).toHaveBeenCalled()
            expect(document.title).not.toBe('Task list')
            expect(window.history.state).toEqual({ object: params[1] })
        }
    })

    it('does not leave an object title on the list if navigation fails', () => {
        jest.spyOn(history, 'pushState').mockImplementation(() => {
            throw new DOMException('History write failed', 'SecurityError')
        })
        expect(() => URLsNotes.push('NOTE_DETAILS_EDITOR', null, 'p1', 'n1', 'Workflow Feature')).toThrow()
        expect(document.title).toBe('Task list')
        expect(window.location.pathname).toBe('/projects/tasks/open')
    })

    it('refreshes titles and state without adding duplicate direct-load/mount entries', () => {
        window.history.replaceState(null, '', '/projects/p1/notes/n1/editor?assistant=1')
        const length = window.history.length
        URLsNotes.push('NOTE_DETAILS_EDITOR', { note: 'n1' }, 'p1', 'n1', 'Workflow Feature')
        expect(window.history.length).toBe(length)
        expect(window.location.search).toBe('?assistant=1')
        expect(document.title).toBe('Alldone.app - Product - Workflow Feature - Editor')
        URLsNotes.push('NOTE_DETAILS_EDITOR', { note: 'n1' }, 'p1', 'n1', 'Renamed workflow')
        expect(window.history.length).toBe(length)
        expect(document.title).toContain('Renamed workflow')
    })

    it('preserves internal titles without changing the document', () => {
        expect(URLsNotes.setTitle('NOTE_DETAILS_EDITOR', true, 'p1', 'n1', 'Workflow Feature')).toBe(
            'Product - Workflow Feature - Editor'
        )
        expect(document.title).toBe('Task list')
    })

    it('sets an assistant title synchronously so a delayed lookup cannot mislabel another view', () => {
        URLsAssistants.push('ASSISTANT_DETAILS', null, 'p1', 'a1')
        expect(document.title).toBe('Alldone.app - Product - Assistant details')
        URLsNotes.push('NOTE_DETAILS_EDITOR', null, 'p1', 'n1', 'Workflow Feature')
        expect(document.title).toBe('Alldone.app - Product - Workflow Feature - Editor')
    })
})
