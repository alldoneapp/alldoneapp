import { writeBrowserHistory } from '../browserHistory'
import URLSystem from '../URLSystem'
import ProjectHelper from '../../components/SettingsView/ProjectsSettings/ProjectHelper'
import { shrinkTagText } from '../../functions/Utils/parseTextUtils'
import {
    ARTIFACT_SECTION_CHAT,
    ARTIFACT_SECTION_DETAILS,
    ARTIFACT_SECTION_UPDATES,
} from '../../components/ArtifactsView/artifactsNavigationState'

/**
 * /projects/artifacts/followed
 */
export const URL_ALL_PROJECTS_ARTIFACTS_FOLLOWED = 'ALL_PROJECTS_ARTIFACTS_FOLLOWED'

/**
 * /projects/artifacts/all
 */
export const URL_ALL_PROJECTS_ARTIFACTS_ALL = 'ALL_PROJECTS_ARTIFACTS_ALL'

/**
 * /projects/{projectId}/artifacts
 */
export const URL_PROJECT_ARTIFACTS = 'PROJECT_ARTIFACTS'

/**
 * /projects/{projectId}/artifacts/{artifactId}
 */
export const URL_ARTIFACT_DETAILS = 'ARTIFACT_DETAILS'

/**
 * /projects/{projectId}/artifacts/{artifactId}/chat
 */
export const URL_ARTIFACT_DETAILS_CHAT = 'ARTIFACT_DETAILS_CHAT'

/**
 * /projects/{projectId}/artifacts/{artifactId}/updates
 */
export const URL_ARTIFACT_DETAILS_UPDATES = 'ARTIFACT_DETAILS_UPDATES'

/**
 * /projects/{projectId}/artifacts/{artifactId}/details
 */
export const URL_ARTIFACT_DETAILS_PROPERTIES = 'ARTIFACT_DETAILS_PROPERTIES'

// The URL of an open artifact showing `section`.
export function getArtifactDetailsUrl(section) {
    if (section === ARTIFACT_SECTION_CHAT) return URL_ARTIFACT_DETAILS_CHAT
    if (section === ARTIFACT_SECTION_UPDATES) return URL_ARTIFACT_DETAILS_UPDATES
    if (section === ARTIFACT_SECTION_DETAILS) return URL_ARTIFACT_DETAILS_PROPERTIES
    return URL_ARTIFACT_DETAILS
}

/**
 * URL System for project artifacts
 */
class URLsArtifacts {
    static replace = (urlConstant, data = null, ...params) => {
        const urlPath = URLsArtifacts.getPath(urlConstant, ...params)
        URLSystem.setLastNavigationScreen(urlPath, true)
        writeBrowserHistory('replace', data, urlPath, () => URLsArtifacts.setTitle(urlConstant, false, ...params))
    }

    static push = (urlConstant, data = null, ...params) => {
        const urlPath = URLsArtifacts.getPath(urlConstant, ...params)
        URLSystem.setLastNavigationScreen(urlPath)
        writeBrowserHistory('push', data, urlPath, () => URLsArtifacts.setTitle(urlConstant, false, ...params))
    }

    static getPath = (urlConstant, ...params) => {
        switch (urlConstant) {
            case URL_ALL_PROJECTS_ARTIFACTS_FOLLOWED:
                return 'projects/artifacts/followed'
            case URL_ALL_PROJECTS_ARTIFACTS_ALL:
                return 'projects/artifacts/all'
            case URL_PROJECT_ARTIFACTS:
                return `projects/${params[0]}/artifacts`
            case URL_ARTIFACT_DETAILS:
                return `projects/${params[0]}/artifacts/${params[1]}`
            case URL_ARTIFACT_DETAILS_CHAT:
                return `projects/${params[0]}/artifacts/${params[1]}/chat`
            case URL_ARTIFACT_DETAILS_UPDATES:
                return `projects/${params[0]}/artifacts/${params[1]}/updates`
            case URL_ARTIFACT_DETAILS_PROPERTIES:
                return `projects/${params[0]}/artifacts/${params[1]}/details`
        }
    }

    // params: projectId, artifactId, artifact title
    static setTitle = (urlConstant, internal = false, ...params) => {
        const prefix = internal ? '' : 'Alldone.app - '
        let title
        if (urlConstant === URL_ALL_PROJECTS_ARTIFACTS_FOLLOWED || urlConstant === URL_ALL_PROJECTS_ARTIFACTS_ALL) {
            title = `${prefix}All Projects - Artifacts`
        } else {
            const projectName = shrinkTagText(ProjectHelper.getProjectNameById(params[0], 'Project'))
            const isDetail =
                urlConstant === URL_ARTIFACT_DETAILS ||
                urlConstant === URL_ARTIFACT_DETAILS_CHAT ||
                urlConstant === URL_ARTIFACT_DETAILS_UPDATES ||
                urlConstant === URL_ARTIFACT_DETAILS_PROPERTIES
            const suffix =
                urlConstant === URL_ARTIFACT_DETAILS_CHAT
                    ? ' - Chat'
                    : urlConstant === URL_ARTIFACT_DETAILS_UPDATES
                      ? ' - Updates'
                      : urlConstant === URL_ARTIFACT_DETAILS_PROPERTIES
                        ? ' - Details'
                        : ''
            title =
                isDetail && params[2]
                    ? `${prefix}${projectName} - ${shrinkTagText(params[2], 100)}${suffix}`
                    : `${prefix}${projectName} - Artifacts`
        }
        !internal && (document.title = title)
        return title
    }
}

export default URLsArtifacts
