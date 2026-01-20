import { URL_NOT_MATCH } from '../URLSystemTrigger'
import {
    URL_PROJECT_DETAILS,
    URL_PROJECT_DETAILS_BACKLINKS_NOTES,
    URL_PROJECT_DETAILS_BACKLINKS_TASKS,
    URL_PROJECT_DETAILS_FEED,
    URL_PROJECT_DETAILS_MEMBERS,
    URL_PROJECT_DETAILS_PROPERTIES,
    URL_PROJECT_DETAILS_STATISTICS,
    URL_PROJECT_DETAILS_WORKSTREAMS,
    URL_PROJECT_DETAILS_ASSISTANTS,
    URL_PROJECT_DETAILS_CONTACT_STATUSES,
} from './URLsProjects'
import ProjectHelper from '../../components/SettingsView/ProjectsSettings/ProjectHelper'
import {
    DV_TAB_PROJECT_BACKLINKS,
    DV_TAB_PROJECT_PROPERTIES,
    DV_TAB_PROJECT_TEAM_MEMBERS,
    DV_TAB_PROJECT_UPDATES,
    DV_TAB_PROJECT_WORKSTREAMS,
    DV_TAB_PROJECT_STATISTICS,
    DV_TAB_PROJECT_ASSISTANTS,
    DV_TAB_PROJECT_CONTACT_STATUSES,
} from '../../utils/TabNavigationConstants'

class URLsProjectsTrigger {
    static getRegexList = () => {
        return {
            [URL_PROJECT_DETAILS]: new RegExp('^/project/(?<projectId>[\\w-]+)$'),
            [URL_PROJECT_DETAILS_PROPERTIES]: new RegExp('^/project/(?<projectId>[\\w-]+)/properties$'),
            [URL_PROJECT_DETAILS_MEMBERS]: new RegExp('^/project/(?<projectId>[\\w-]+)/members$'),
            [URL_PROJECT_DETAILS_WORKSTREAMS]: new RegExp('^/project/(?<projectId>[\\w-]+)/workstreams$'),
            [URL_PROJECT_DETAILS_BACKLINKS_TASKS]: new RegExp('^/project/(?<projectId>[\\w-]+)/backlinks/tasks$'),
            [URL_PROJECT_DETAILS_BACKLINKS_NOTES]: new RegExp('^/project/(?<projectId>[\\w-]+)/backlinks/notes$'),
            [URL_PROJECT_DETAILS_FEED]: new RegExp('^/project/(?<projectId>[\\w-]+)/updates$'),
            [URL_PROJECT_DETAILS_STATISTICS]: new RegExp('^/project/(?<projectId>[\\w-]+)/statistics$'),
            [URL_PROJECT_DETAILS_ASSISTANTS]: new RegExp('^/project/(?<projectId>[\\w-]+)/assistants$'),
            [URL_PROJECT_DETAILS_CONTACT_STATUSES]: new RegExp('^/project/(?<projectId>[\\w-]+)/contact-statuses$'),
            // [URL_PROJECT_ARCHIVE]: new RegExp('^/project/(?<projectId>[\\w-]+)/archive$'),
            // [URL_PROJECT_UNARCHIVE]: new RegExp('^/project/(?<projectId>[\\w-]+)/unarchive$'),
        }
    }

    static match = pathname => {
        const regexList = URLsProjectsTrigger.getRegexList()

        for (let key in regexList) {
            const matchObj = pathname.match(regexList[key])

            if (matchObj) {
                return { key: key, matches: matchObj }
            }
        }

        return URL_NOT_MATCH
    }

    static trigger = (navigation, pathname) => {
        const matchedObj = URLsProjectsTrigger.match(pathname)
        const params = matchedObj.matches.groups

        // This Switch will have CASEs as elements have the "regexList" const
        switch (matchedObj.key) {
            case URL_PROJECT_DETAILS:
                return ProjectHelper.processURLProjectDetails(navigation, params.projectId)
            case URL_PROJECT_DETAILS_PROPERTIES:
                return ProjectHelper.processURLProjectDetailsTab(
                    navigation,
                    DV_TAB_PROJECT_PROPERTIES,
                    params.projectId
                )
            case URL_PROJECT_DETAILS_MEMBERS:
                return ProjectHelper.processURLProjectDetailsTab(
                    navigation,
                    DV_TAB_PROJECT_TEAM_MEMBERS,
                    params.projectId
                )
            case URL_PROJECT_DETAILS_ASSISTANTS:
                return ProjectHelper.processURLProjectDetailsTab(
                    navigation,
                    DV_TAB_PROJECT_ASSISTANTS,
                    params.projectId
                )
            case URL_PROJECT_DETAILS_WORKSTREAMS:
                return ProjectHelper.processURLProjectDetailsTab(
                    navigation,
                    DV_TAB_PROJECT_WORKSTREAMS,
                    params.projectId
                )
            case URL_PROJECT_DETAILS_FEED:
                return ProjectHelper.processURLProjectDetailsTab(navigation, DV_TAB_PROJECT_UPDATES, params.projectId)
            case URL_PROJECT_DETAILS_STATISTICS:
                return ProjectHelper.processURLProjectDetailsTab(
                    navigation,
                    DV_TAB_PROJECT_STATISTICS,
                    params.projectId
                )
            case URL_PROJECT_DETAILS_BACKLINKS_TASKS:
                return ProjectHelper.processURLProjectDetailsTab(
                    navigation,
                    DV_TAB_PROJECT_BACKLINKS,
                    params.projectId,
                    URL_PROJECT_DETAILS_BACKLINKS_TASKS
                )
            case URL_PROJECT_DETAILS_BACKLINKS_NOTES:
                return ProjectHelper.processURLProjectDetailsTab(
                    navigation,
                    DV_TAB_PROJECT_BACKLINKS,
                    params.projectId,
                    URL_PROJECT_DETAILS_BACKLINKS_NOTES
                )
            case URL_PROJECT_DETAILS_CONTACT_STATUSES:
                return ProjectHelper.processURLProjectDetailsTab(
                    navigation,
                    DV_TAB_PROJECT_CONTACT_STATUSES,
                    params.projectId
                )
        }
    }
}

export default URLsProjectsTrigger
