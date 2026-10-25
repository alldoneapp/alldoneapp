import { writeBrowserHistory } from '../browserHistory'
import URLSystem from '../URLSystem'
import ProjectHelper from '../../components/SettingsView/ProjectsSettings/ProjectHelper'
import { shrinkTagText } from '../../functions/Utils/parseTextUtils'

/**
 * /projects/{projectId}/wiki
 */
export const URL_PROJECT_WIKI = 'PROJECT_WIKI'

/**
 * /projects/{projectId}/wiki/{slug}
 */
export const URL_PROJECT_WIKI_PAGE = 'PROJECT_WIKI_PAGE'

/**
 * URL System for the project wiki
 */
class URLsWiki {
    static replace = (urlConstant, data = null, ...params) => {
        const urlPath = URLsWiki.getPath(urlConstant, ...params)
        URLSystem.setLastNavigationScreen(urlPath, true)
        writeBrowserHistory('replace', data, urlPath, () => URLsWiki.setTitle(urlConstant, false, ...params))
    }

    static push = (urlConstant, data = null, ...params) => {
        const urlPath = URLsWiki.getPath(urlConstant, ...params)
        URLSystem.setLastNavigationScreen(urlPath)
        writeBrowserHistory('push', data, urlPath, () => URLsWiki.setTitle(urlConstant, false, ...params))
    }

    static getPath = (urlConstant, ...params) => {
        switch (urlConstant) {
            case URL_PROJECT_WIKI:
                return `projects/${params[0]}/wiki`
            case URL_PROJECT_WIKI_PAGE:
                return `projects/${params[0]}/wiki/${params[1]}`
        }
    }

    // params: projectId, slug, page title
    static setTitle = (urlConstant, internal = false, ...params) => {
        const prefix = internal ? '' : 'Alldone.app - '
        const projectName = shrinkTagText(ProjectHelper.getProjectNameById(params[0], 'Project'))
        const title =
            urlConstant === URL_PROJECT_WIKI_PAGE
                ? `${prefix}${projectName} - ${shrinkTagText(params[2] || params[1] || 'Wiki', 100)}`
                : `${prefix}${projectName} - Wiki`
        !internal && (document.title = title)
        return title
    }
}

export default URLsWiki
