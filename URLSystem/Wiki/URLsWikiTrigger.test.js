const mockState = {
    lastVisitedScreen: [],
    loggedUser: { uid: 'user-1' },
    loggedUserProjects: [{ id: 'project-a' }, { id: 'project-b' }],
}
jest.mock('../../redux/store', () => ({ getState: () => mockState, dispatch: jest.fn() }))
jest.mock('../../redux/actions', () => ({
    navigateToAllProjectsTasks: () => ({ type: 'navigateToAllProjectsTasks' }),
    setLastVisitedScreen: screens => ({ type: 'setLastVisitedScreen', screens }),
    setSelectedSidebarTab: tab => ({ type: 'setSelectedSidebarTab', tab }),
    storeCurrentUser: user => ({ type: 'storeCurrentUser', user }),
    switchProject: index => ({ type: 'switchProject', index }),
}))
jest.mock('../../components/SettingsView/ProjectsSettings/ProjectHelper', () => ({
    __esModule: true,
    default: { getProjectNameById: () => 'Product' },
    checkIfSelectedProject: index => index >= 0,
}))
jest.mock('../../utils/HelperFunctions', () => ({ getFirstName: value => value }))
jest.mock('../URLSystemTrigger', () => ({ URL_NOT_MATCH: 'URL_NOT_MATCH' }))
jest.mock('../URLTrigger', () => ({ __esModule: true, default: { processUrl: jest.fn() } }))
jest.mock('../../utils/NavigationService', () => ({}))
jest.mock('../../utils/LinkingHelper', () => ({ getDvMainTabLink: jest.fn() }))
jest.mock('../Tasks/URLsTasks', () => ({
    __esModule: true,
    default: { replace: jest.fn() },
    URL_ALL_PROJECTS_TASKS_OPEN: 'ALL_PROJECTS_TASKS_OPEN',
}))

import store from '../../redux/store'
import URLsTasks from '../Tasks/URLsTasks'
import URLsWikiTrigger from './URLsWikiTrigger'
import {
    URL_PROJECT_WIKI,
    URL_PROJECT_WIKI_PAGE,
    URL_PROJECT_WIKI_PAGE_CHANGE,
    URL_PROJECT_WIKI_PAGE_CHANGES_SINCE,
} from './URLsWiki'
import { URL_NOT_MATCH } from '../URLSystemTrigger'
import {
    getWikiSelectedRevision,
    getWikiSelectedSince,
    getWikiSelectedSlug,
    setWikiSelectedRange,
    setWikiSelectedSlug,
} from '../../components/WikiView/wikiNavigationState'
import { getProjectWikiChangesSincePath, getProjectWikiPath } from '../../components/WikiView/wikiLinks'
import { DV_TAB_ROOT_WIKI } from '../../utils/TabNavigationConstants'

const navigation = { navigate: jest.fn() }

beforeEach(() => {
    jest.clearAllMocks()
    setWikiSelectedSlug('project-a', null)
    window.history.replaceState(null, '', '/projects/tasks/open')
})

describe('wiki URLs', () => {
    it('matches the wiki and a page of it, and nothing that only looks similar', () => {
        expect(URLsWikiTrigger.match('/projects/project-a/wiki').key).toBe(URL_PROJECT_WIKI)
        const page = URLsWikiTrigger.match('/projects/project-a/wiki/kunden-und-partner')
        expect(page.key).toBe(URL_PROJECT_WIKI_PAGE)
        expect(page.matches.groups).toMatchObject({ projectId: 'project-a', slug: 'kunden-und-partner' })

        expect(URLsWikiTrigger.match('/projects/project-a/wiki/Kunden')).toBe(URL_NOT_MATCH)
        expect(URLsWikiTrigger.match('/projects/project-a/wiki/kunden/edit')).toBe(URL_NOT_MATCH)
        expect(URLsWikiTrigger.match('/projects/project-a/wiki-settings')).toBe(URL_NOT_MATCH)
    })

    it('builds the same paths the trigger matches', () => {
        expect(URLsWikiTrigger.match(getProjectWikiPath('project-a')).key).toBe(URL_PROJECT_WIKI)
        expect(URLsWikiTrigger.match(getProjectWikiPath('project-a', 'kunden')).key).toBe(URL_PROJECT_WIKI_PAGE)
        expect(URLsWikiTrigger.match(getProjectWikiPath('project-a', 'kunden', 12)).key).toBe(
            URL_PROJECT_WIKI_PAGE_CHANGE
        )
    })

    it('matches what one revision of a page changed, and only a real revision number', () => {
        const change = URLsWikiTrigger.match('/projects/project-a/wiki/kunden/changes/12')
        expect(change.key).toBe(URL_PROJECT_WIKI_PAGE_CHANGE)
        expect(change.matches.groups).toMatchObject({ projectId: 'project-a', slug: 'kunden', revision: '12' })

        expect(URLsWikiTrigger.match('/projects/project-a/wiki/kunden/changes/0')).toBe(URL_NOT_MATCH)
        expect(URLsWikiTrigger.match('/projects/project-a/wiki/kunden/changes/x')).toBe(URL_NOT_MATCH)
        expect(URLsWikiTrigger.match('/projects/project-a/wiki/kunden/changes')).toBe(URL_NOT_MATCH)
    })

    it('opens the change on its page, and opening the page alone closes it again', () => {
        URLsWikiTrigger.trigger(navigation, '/projects/project-b/wiki/kunden/changes/4')

        expect(getWikiSelectedSlug('project-b')).toBe('kunden')
        expect(getWikiSelectedRevision('project-b')).toBe(4)
        expect(window.location.pathname).toBe('/projects/project-b/wiki/kunden/changes/4')

        URLsWikiTrigger.trigger(navigation, '/projects/project-b/wiki/kunden')

        expect(getWikiSelectedSlug('project-b')).toBe('kunden')
        expect(getWikiSelectedRevision('project-b')).toBeNull()
    })

    describe('what a page changed since one of its revisions (AT-2878)', () => {
        it('matches a base revision from 0 and builds the same path', () => {
            const range = URLsWikiTrigger.match('/projects/project-a/wiki/kunden/changes/since/7')
            expect(range.key).toBe(URL_PROJECT_WIKI_PAGE_CHANGES_SINCE)
            expect(range.matches.groups).toMatchObject({ projectId: 'project-a', slug: 'kunden', since: '7' })
            expect(URLsWikiTrigger.match('/projects/project-a/wiki/kunden/changes/since/0').key).toBe(
                URL_PROJECT_WIKI_PAGE_CHANGES_SINCE
            )
            expect(URLsWikiTrigger.match(getProjectWikiChangesSincePath('project-a', 'kunden', 3)).key).toBe(
                URL_PROJECT_WIKI_PAGE_CHANGES_SINCE
            )

            expect(URLsWikiTrigger.match('/projects/project-a/wiki/kunden/changes/since/01')).toBe(URL_NOT_MATCH)
            expect(URLsWikiTrigger.match('/projects/project-a/wiki/kunden/changes/since/-1')).toBe(URL_NOT_MATCH)
            expect(URLsWikiTrigger.match('/projects/project-a/wiki/kunden/changes/since')).toBe(URL_NOT_MATCH)
        })

        it('opens the range on its page and keeps its address; a single change or the page closes it', () => {
            URLsWikiTrigger.trigger(navigation, '/projects/project-b/wiki/kunden/changes/since/0')

            expect(getWikiSelectedSlug('project-b')).toBe('kunden')
            expect(getWikiSelectedSince('project-b')).toBe(0)
            expect(getWikiSelectedRevision('project-b')).toBeNull()
            expect(window.location.pathname).toBe('/projects/project-b/wiki/kunden/changes/since/0')

            URLsWikiTrigger.trigger(navigation, '/projects/project-b/wiki/kunden/changes/4')
            expect(getWikiSelectedRevision('project-b')).toBe(4)
            expect(getWikiSelectedSince('project-b')).toBeNull()

            setWikiSelectedRange('project-b', 'kunden', 2)
            URLsWikiTrigger.trigger(navigation, '/projects/project-b/wiki/kunden')
            expect(getWikiSelectedSince('project-b')).toBeNull()
        })

        it('does not open a range for anyone who is not a member', () => {
            URLsWikiTrigger.trigger(navigation, '/projects/someone-elses/wiki/kunden/changes/since/1')
            expect(getWikiSelectedSince('someone-elses')).toBeNull()
            expect(URLsTasks.replace).toHaveBeenCalledWith('ALL_PROJECTS_TASKS_OPEN')
        })
    })

    it('opens the wiki tab of a project the user belongs to, on the requested page', () => {
        URLsWikiTrigger.trigger(navigation, '/projects/project-b/wiki/kunden')

        expect(navigation.navigate).toHaveBeenCalledWith('Root')
        expect(getWikiSelectedSlug('project-b')).toBe('kunden')
        expect(store.dispatch).toHaveBeenCalledWith([
            { type: 'setSelectedSidebarTab', tab: DV_TAB_ROOT_WIKI },
            { type: 'storeCurrentUser', user: mockState.loggedUser },
            { type: 'switchProject', index: 1 },
        ])
        expect(window.location.pathname).toBe('/projects/project-b/wiki/kunden')
    })

    it('opening the wiki without a page clears a page chosen earlier', () => {
        setWikiSelectedSlug('project-a', 'kunden')

        URLsWikiTrigger.trigger(navigation, '/projects/project-a/wiki')

        expect(getWikiSelectedSlug('project-a')).toBeNull()
    })

    it('sends anyone who is not a member to the task board instead', () => {
        URLsWikiTrigger.trigger(navigation, '/projects/someone-elses/wiki')

        expect(getWikiSelectedSlug('someone-elses')).toBeNull()
        expect(URLsTasks.replace).toHaveBeenCalledWith('ALL_PROJECTS_TASKS_OPEN')
        expect(store.dispatch).toHaveBeenCalledWith({ type: 'navigateToAllProjectsTasks' })
    })
})
