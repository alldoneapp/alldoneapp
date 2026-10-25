const mockState = {
    lastVisitedScreen: [],
    loggedUser: { uid: 'user-1' },
    loggedUserProjects: [{ id: 'project-a' }, { id: 'project-b' }],
}
jest.mock('../../redux/store', () => ({ getState: () => mockState, dispatch: jest.fn() }))
jest.mock('../../redux/actions', () => ({
    navigateToAllProjectsArtifacts: () => ({ type: 'navigateToAllProjectsArtifacts' }),
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
jest.mock('../Tasks/URLsTasks', () => ({
    __esModule: true,
    default: { replace: jest.fn() },
    URL_ALL_PROJECTS_TASKS_OPEN: 'ALL_PROJECTS_TASKS_OPEN',
}))

import store from '../../redux/store'
import URLsTasks from '../Tasks/URLsTasks'
import URLsArtifactsTrigger from './URLsArtifactsTrigger'
import {
    URL_ALL_PROJECTS_ARTIFACTS_ALL,
    URL_ALL_PROJECTS_ARTIFACTS_FOLLOWED,
    URL_ARTIFACT_DETAILS,
    URL_ARTIFACT_DETAILS_CHAT,
    URL_PROJECT_ARTIFACTS,
} from './URLsArtifacts'
import { URL_NOT_MATCH } from '../URLSystemTrigger'
import {
    getArtifactSection,
    getArtifactsActiveTab,
    getSelectedArtifactId,
    setArtifactsActiveTab,
    setSelectedArtifactId,
} from '../../components/ArtifactsView/artifactsNavigationState'
import { getProjectArtifactsPath } from '../../components/ArtifactsView/artifactLinks'
import { ALL_TAB, FOLLOWED_TAB } from '../../components/Feeds/Utils/FeedsConstants'
import { DV_TAB_ROOT_ARTIFACTS } from '../../utils/TabNavigationConstants'

const navigation = { navigate: jest.fn() }

beforeEach(() => {
    jest.clearAllMocks()
    setSelectedArtifactId('project-a', null)
    setSelectedArtifactId('project-b', null)
    setArtifactsActiveTab(ALL_TAB)
    window.history.replaceState(null, '', '/projects/tasks/open')
})

describe('artifact URLs', () => {
    it('matches the all-projects lists, a project list and an artifact', () => {
        expect(URLsArtifactsTrigger.match('/projects/artifacts/followed').key).toBe(URL_ALL_PROJECTS_ARTIFACTS_FOLLOWED)
        expect(URLsArtifactsTrigger.match('/projects/artifacts/all').key).toBe(URL_ALL_PROJECTS_ARTIFACTS_ALL)
        expect(URLsArtifactsTrigger.match('/projects/project-a/artifacts').key).toBe(URL_PROJECT_ARTIFACTS)
        const detail = URLsArtifactsTrigger.match('/projects/project-a/artifacts/abc_123-x')
        expect(detail.key).toBe(URL_ARTIFACT_DETAILS)
        expect(detail.matches.groups).toMatchObject({ projectId: 'project-a', artifactId: 'abc_123-x' })

        const chat = URLsArtifactsTrigger.match('/projects/project-a/artifacts/abc/chat')
        expect(chat.key).toBe(URL_ARTIFACT_DETAILS_CHAT)
        expect(chat.matches.groups).toMatchObject({ projectId: 'project-a', artifactId: 'abc' })

        expect(URLsArtifactsTrigger.match('/projects/project-a/artifacts/abc/versions')).toBe(URL_NOT_MATCH)
        expect(URLsArtifactsTrigger.match('/projects/project-a/artifact')).toBe(URL_NOT_MATCH)
    })

    it('builds the same paths the trigger matches', () => {
        expect(URLsArtifactsTrigger.match(getProjectArtifactsPath('project-a')).key).toBe(URL_PROJECT_ARTIFACTS)
        expect(URLsArtifactsTrigger.match(getProjectArtifactsPath('project-a', 'abc')).key).toBe(URL_ARTIFACT_DETAILS)
        expect(URLsArtifactsTrigger.match(getProjectArtifactsPath('project-a', 'abc', { chat: true })).key).toBe(
            URL_ARTIFACT_DETAILS_CHAT
        )
    })

    it('opens an artifact of a project the user belongs to', () => {
        URLsArtifactsTrigger.trigger(navigation, '/projects/project-b/artifacts/abc')

        expect(navigation.navigate).toHaveBeenCalledWith('Root')
        expect(getSelectedArtifactId('project-b')).toBe('abc')
        expect(store.dispatch).toHaveBeenCalledWith([
            { type: 'setSelectedSidebarTab', tab: DV_TAB_ROOT_ARTIFACTS },
            { type: 'storeCurrentUser', user: mockState.loggedUser },
            { type: 'switchProject', index: 1 },
        ])
        expect(window.location.pathname).toBe('/projects/project-b/artifacts/abc')
    })

    it("opens an artifact's chat, and the artifact again without it", () => {
        URLsArtifactsTrigger.trigger(navigation, '/projects/project-b/artifacts/abc/chat')
        expect(getSelectedArtifactId('project-b')).toBe('abc')
        expect(getArtifactSection('project-b')).toBe('chat')
        expect(window.location.pathname).toBe('/projects/project-b/artifacts/abc/chat')

        URLsArtifactsTrigger.trigger(navigation, '/projects/project-b/artifacts/abc')
        expect(getArtifactSection('project-b')).toBe('artifact')
        expect(window.location.pathname).toBe('/projects/project-b/artifacts/abc')
    })

    it("opens an artifact's updates and keeps the section in the address", () => {
        expect(URLsArtifactsTrigger.match('/projects/project-a/artifacts/abc/updates').matches.groups).toMatchObject({
            projectId: 'project-a',
            artifactId: 'abc',
        })
        URLsArtifactsTrigger.trigger(navigation, '/projects/project-b/artifacts/abc/updates')
        expect(getArtifactSection('project-b')).toBe('updates')
        expect(window.location.pathname).toBe('/projects/project-b/artifacts/abc/updates')
    })

    it('opening the project list closes an artifact opened earlier', () => {
        setSelectedArtifactId('project-a', 'abc')
        URLsArtifactsTrigger.trigger(navigation, '/projects/project-a/artifacts')
        expect(getSelectedArtifactId('project-a')).toBeNull()
        expect(window.location.pathname).toBe('/projects/project-a/artifacts')
    })

    it('opens the all-projects list on the requested tab', () => {
        URLsArtifactsTrigger.trigger(navigation, '/projects/artifacts/followed')

        expect(getArtifactsActiveTab()).toBe(FOLLOWED_TAB)
        expect(store.dispatch).toHaveBeenCalledWith({ type: 'navigateToAllProjectsArtifacts' })
        expect(window.location.pathname).toBe('/projects/artifacts/followed')
    })

    it('sends anyone who is not a member to the task board instead', () => {
        URLsArtifactsTrigger.trigger(navigation, '/projects/someone-elses/artifacts/abc')

        expect(getSelectedArtifactId('someone-elses')).toBeNull()
        expect(URLsTasks.replace).toHaveBeenCalledWith('ALL_PROJECTS_TASKS_OPEN')
        expect(store.dispatch).toHaveBeenCalledWith({ type: 'navigateToAllProjectsTasks' })
    })
})
