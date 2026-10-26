import { findIndex } from 'lodash'

import { URL_NOT_MATCH } from '../URLSystemTrigger'
import URLsArtifacts, {
    URL_ALL_PROJECTS_ARTIFACTS_ALL,
    URL_ALL_PROJECTS_ARTIFACTS_FOLLOWED,
    URL_ARTIFACT_DETAILS,
    URL_ARTIFACT_DETAILS_CHAT,
    URL_ARTIFACT_DETAILS_UPDATES,
    URL_PROJECT_ARTIFACTS,
    getArtifactDetailsUrl,
} from './URLsArtifacts'
import URLsTasks, { URL_ALL_PROJECTS_TASKS_OPEN } from '../Tasks/URLsTasks'
import store from '../../redux/store'
import {
    navigateToAllProjectsArtifacts,
    navigateToAllProjectsTasks,
    setSelectedSidebarTab,
    storeCurrentUser,
    switchProject,
} from '../../redux/actions'
import { DV_TAB_ROOT_ARTIFACTS } from '../../utils/TabNavigationConstants'
import { checkIfSelectedProject } from '../../components/SettingsView/ProjectsSettings/ProjectHelper'
import { ALL_TAB, FOLLOWED_TAB } from '../../components/Feeds/Utils/FeedsConstants'
import {
    ARTIFACT_SECTION_ARTIFACT,
    ARTIFACT_SECTION_CHAT,
    ARTIFACT_SECTION_UPDATES,
    setArtifactsActiveTab,
    setSelectedArtifactId,
} from '../../components/ArtifactsView/artifactsNavigationState'

const SECTION_BY_URL = {
    [URL_ARTIFACT_DETAILS_CHAT]: ARTIFACT_SECTION_CHAT,
    [URL_ARTIFACT_DETAILS_UPDATES]: ARTIFACT_SECTION_UPDATES,
}

class URLsArtifactsTrigger {
    static getRegexList = () => {
        return {
            [URL_ALL_PROJECTS_ARTIFACTS_FOLLOWED]: new RegExp('^/projects/artifacts/followed$'),
            [URL_ALL_PROJECTS_ARTIFACTS_ALL]: new RegExp('^/projects/artifacts/all$'),
            [URL_PROJECT_ARTIFACTS]: new RegExp('^/projects/(?<projectId>[\\w-]+)/artifacts$'),
            [URL_ARTIFACT_DETAILS]: new RegExp('^/projects/(?<projectId>[\\w-]+)/artifacts/(?<artifactId>[\\w-]+)$'),
            [URL_ARTIFACT_DETAILS_CHAT]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/artifacts/(?<artifactId>[\\w-]+)/chat$'
            ),
            [URL_ARTIFACT_DETAILS_UPDATES]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/artifacts/(?<artifactId>[\\w-]+)/updates$'
            ),
        }
    }

    static match = pathname => {
        const regexList = URLsArtifactsTrigger.getRegexList()
        for (let key in regexList) {
            const matchObj = pathname.match(regexList[key])
            if (matchObj) return { key: key, matches: matchObj }
        }
        return URL_NOT_MATCH
    }

    static trigger = (navigation, pathname) => {
        const matchedObj = URLsArtifactsTrigger.match(pathname)
        const params = matchedObj.matches.groups || {}
        switch (matchedObj.key) {
            case URL_ALL_PROJECTS_ARTIFACTS_FOLLOWED:
                return URLsArtifactsTrigger.processURLAllProjectsArtifacts(navigation, FOLLOWED_TAB)
            case URL_ALL_PROJECTS_ARTIFACTS_ALL:
                return URLsArtifactsTrigger.processURLAllProjectsArtifacts(navigation, ALL_TAB)
            default:
                return URLsArtifactsTrigger.processURLProjectArtifacts(
                    navigation,
                    params.projectId,
                    params.artifactId || null,
                    SECTION_BY_URL[matchedObj.key] || ARTIFACT_SECTION_ARTIFACT
                )
        }
    }

    static processURLAllProjectsArtifacts = (navigation, tab) => {
        navigation.navigate('Root')
        setArtifactsActiveTab(tab)
        store.dispatch(navigateToAllProjectsArtifacts())
        URLsArtifacts.replace(tab === ALL_TAB ? URL_ALL_PROJECTS_ARTIFACTS_ALL : URL_ALL_PROJECTS_ARTIFACTS_FOLLOWED)
    }

    // Artifacts are for the project's readers, like its notes. Anyone outside the project lands on
    // the all-projects board, exactly as for an unknown URL.
    static processURLProjectArtifacts = (navigation, projectId, artifactId, section = ARTIFACT_SECTION_ARTIFACT) => {
        const { loggedUserProjects, loggedUser } = store.getState()
        const projectIndex = findIndex(loggedUserProjects, ['id', projectId])

        navigation.navigate('Root')

        if (!checkIfSelectedProject(projectIndex)) {
            URLsTasks.replace(URL_ALL_PROJECTS_TASKS_OPEN)
            store.dispatch(navigateToAllProjectsTasks())
            return
        }

        setSelectedArtifactId(projectId, artifactId, section)
        store.dispatch([
            setSelectedSidebarTab(DV_TAB_ROOT_ARTIFACTS),
            storeCurrentUser(loggedUser),
            switchProject(projectIndex),
        ])
        if (artifactId) URLsArtifacts.replace(getArtifactDetailsUrl(section), null, projectId, artifactId)
        else URLsArtifacts.replace(URL_PROJECT_ARTIFACTS, null, projectId)
    }
}

export default URLsArtifactsTrigger
