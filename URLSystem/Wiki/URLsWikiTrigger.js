import { findIndex } from 'lodash'

import { URL_NOT_MATCH } from '../URLSystemTrigger'
import URLsWiki, { URL_PROJECT_WIKI, URL_PROJECT_WIKI_PAGE } from './URLsWiki'
import URLsTasks, { URL_ALL_PROJECTS_TASKS_OPEN } from '../Tasks/URLsTasks'
import store from '../../redux/store'
import { navigateToAllProjectsTasks, setSelectedSidebarTab, storeCurrentUser, switchProject } from '../../redux/actions'
import { DV_TAB_ROOT_WIKI } from '../../utils/TabNavigationConstants'
import { checkIfSelectedProject } from '../../components/SettingsView/ProjectsSettings/ProjectHelper'
import { setWikiSelectedSlug } from '../../components/WikiView/wikiNavigationState'

class URLsWikiTrigger {
    static getRegexList = () => {
        return {
            [URL_PROJECT_WIKI]: new RegExp('^/projects/(?<projectId>[\\w-]+)/wiki$'),
            [URL_PROJECT_WIKI_PAGE]: new RegExp('^/projects/(?<projectId>[\\w-]+)/wiki/(?<slug>[a-z0-9-]+)$'),
        }
    }

    static match = pathname => {
        const regexList = URLsWikiTrigger.getRegexList()
        for (let key in regexList) {
            const matchObj = pathname.match(regexList[key])
            if (matchObj) return { key: key, matches: matchObj }
        }
        return URL_NOT_MATCH
    }

    static trigger = (navigation, pathname) => {
        const matchedObj = URLsWikiTrigger.match(pathname)
        const params = matchedObj.matches.groups
        return URLsWikiTrigger.processURLProjectWiki(navigation, params.projectId, params.slug || null)
    }

    // The wiki is for the project's members only, so there is no join flow: anyone else lands on the
    // all-projects board, exactly as for an unknown URL.
    static processURLProjectWiki = (navigation, projectId, slug) => {
        const { loggedUserProjects, loggedUser } = store.getState()
        const projectIndex = findIndex(loggedUserProjects, ['id', projectId])

        navigation.navigate('Root')

        if (!checkIfSelectedProject(projectIndex)) {
            URLsTasks.replace(URL_ALL_PROJECTS_TASKS_OPEN)
            store.dispatch(navigateToAllProjectsTasks())
            return
        }

        setWikiSelectedSlug(projectId, slug)
        store.dispatch([
            setSelectedSidebarTab(DV_TAB_ROOT_WIKI),
            storeCurrentUser(loggedUser),
            switchProject(projectIndex),
        ])
        URLsWiki.replace(slug ? URL_PROJECT_WIKI_PAGE : URL_PROJECT_WIKI, null, projectId, slug)
    }
}

export default URLsWikiTrigger
