import { URL_NOT_MATCH } from '../URLSystemTrigger'
import {
    URL_ALL_PROJECTS_PEOPLE_ALL,
    URL_ALL_PROJECTS_PEOPLE_FOLLOWED,
    URL_PEOPLE_DETAILS,
    URL_PEOPLE_DETAILS_BACKLINKS_NOTES,
    URL_PEOPLE_DETAILS_BACKLINKS_TASKS,
    URL_PEOPLE_DETAILS_CHAT,
    URL_PEOPLE_DETAILS_FEED,
    URL_PEOPLE_DETAILS_PROPERTIES,
    URL_PEOPLE_DETAILS_NOTE,
    URL_PEOPLE_DETAILS_STATISTICS,
    URL_PEOPLE_DETAILS_WORKFLOW,
    URL_PROJECT_PEOPLE_ADD,
    URL_PROJECT_PEOPLE_ALL,
    URL_PROJECT_PEOPLE_FOLLOWED,
    URL_PEOPLE_DETAILS_PROFILE,
} from './URLsPeople'
import ContactsHelper from '../../components/ContactsView/Utils/ContactsHelper'
import { ALL_TAB, FOLLOWED_TAB } from '../../components/Feeds/Utils/FeedsConstants'
import {
    DV_TAB_USER_BACKLINKS,
    DV_TAB_USER_CHAT,
    DV_TAB_USER_NOTE,
    DV_TAB_USER_PROPERTIES,
    DV_TAB_USER_PROFILE,
    DV_TAB_USER_STATISTICS,
    DV_TAB_USER_UPDATES,
    DV_TAB_USER_WORKFLOW,
} from '../../utils/TabNavigationConstants'
import store from '../../redux/store'
import SharedHelper from '../../utils/SharedHelper'

class URLsPeopleTrigger {
    static getRegexList = () => {
        return {
            [URL_ALL_PROJECTS_PEOPLE_ALL]: new RegExp('^/projects/contacts/all$'),
            [URL_ALL_PROJECTS_PEOPLE_FOLLOWED]: new RegExp('^/projects/contacts/followed$'),
            [URL_PROJECT_PEOPLE_ALL]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w-]+)/contacts/all$'
            ),
            [URL_PROJECT_PEOPLE_FOLLOWED]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w-]+)/contacts/followed$'
            ),
            [URL_PEOPLE_DETAILS]: new RegExp('^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)$'),
            [URL_PEOPLE_DETAILS_FEED]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/updates$'
            ),
            [URL_PEOPLE_DETAILS_WORKFLOW]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/workflow$'
            ),
            [URL_PEOPLE_DETAILS_PROPERTIES]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/properties$'
            ),
            [URL_PEOPLE_DETAILS_PROFILE]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/profile$'
            ),
            [URL_PEOPLE_DETAILS_CHAT]: new RegExp('^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/chat$'),
            [URL_PEOPLE_DETAILS_NOTE]: new RegExp('^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/note$'),
            [URL_PEOPLE_DETAILS_STATISTICS]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/statistics$'
            ),
            [URL_PEOPLE_DETAILS_BACKLINKS_TASKS]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/backlinks/tasks$'
            ),
            [URL_PEOPLE_DETAILS_BACKLINKS_NOTES]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/backlinks/notes$'
            ),
            [URL_PROJECT_PEOPLE_ADD]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[^\\/\\s]+)/add$'
            ),
        }
    }

    static match = pathname => {
        const regexList = URLsPeopleTrigger.getRegexList()

        for (let key in regexList) {
            const matchObj = pathname.match(regexList[key])

            if (matchObj) {
                return { key: key, matches: matchObj }
            }
        }

        return URL_NOT_MATCH
    }

    static urlPointToJoinLogic(pathname) {
        const urlMatchingForJoinUser = [URL_PROJECT_PEOPLE_ADD]

        const matchedObj = URLsPeopleTrigger.match(pathname)

        return urlMatchingForJoinUser.includes(matchedObj.key)
    }

    static trigger = (navigation, pathname) => {
        const matchedObj = URLsPeopleTrigger.match(pathname)
        const params = matchedObj.matches.groups

        // This Switch will have CASEs as elements have the "regexList" const
        switch (matchedObj.key) {
            case URL_ALL_PROJECTS_PEOPLE_ALL:
                return ContactsHelper.processURLAllProjectsPeople(navigation, ALL_TAB)
            case URL_ALL_PROJECTS_PEOPLE_FOLLOWED:
                return ContactsHelper.processURLAllProjectsPeople(navigation, FOLLOWED_TAB)
            case URL_PROJECT_PEOPLE_ALL:
                return ContactsHelper.processURLProjectPeople(navigation, params.projectId, params.userId, ALL_TAB)
            case URL_PROJECT_PEOPLE_FOLLOWED:
                return ContactsHelper.processURLProjectPeople(navigation, params.projectId, params.userId, FOLLOWED_TAB)
            case URL_PEOPLE_DETAILS:
                return ContactsHelper.processURLPeopleDetails(navigation, params.projectId, params.userId)
            case URL_PEOPLE_DETAILS_FEED:
                return ContactsHelper.processURLPeopleDetailsTab(
                    navigation,
                    DV_TAB_USER_UPDATES,
                    params.projectId,
                    params.userId
                )
            case URL_PEOPLE_DETAILS_WORKFLOW:
                return ContactsHelper.processURLPeopleDetailsTab(
                    navigation,
                    DV_TAB_USER_WORKFLOW,
                    params.projectId,
                    params.userId
                )
            case URL_PEOPLE_DETAILS_PROPERTIES:
                return ContactsHelper.processURLPeopleDetailsTab(
                    navigation,
                    DV_TAB_USER_PROPERTIES,
                    params.projectId,
                    params.userId
                )
            case URL_PEOPLE_DETAILS_PROFILE:
                return ContactsHelper.processURLPeopleDetailsTab(
                    navigation,
                    DV_TAB_USER_PROFILE,
                    params.projectId,
                    params.userId
                )
            case URL_PEOPLE_DETAILS_NOTE:
                return ContactsHelper.processURLPeopleDetailsTab(
                    navigation,
                    DV_TAB_USER_NOTE,
                    params.projectId,
                    params.userId
                )
            case URL_PEOPLE_DETAILS_CHAT:
                return ContactsHelper.processURLPeopleDetailsTab(
                    navigation,
                    DV_TAB_USER_CHAT,
                    params.projectId,
                    params.userId
                )
            case URL_PEOPLE_DETAILS_STATISTICS:
                return ContactsHelper.processURLPeopleDetailsTab(
                    navigation,
                    DV_TAB_USER_STATISTICS,
                    params.projectId,
                    params.userId
                )
            case URL_PEOPLE_DETAILS_BACKLINKS_TASKS:
                return ContactsHelper.processURLPeopleDetailsTab(
                    navigation,
                    DV_TAB_USER_BACKLINKS,
                    params.projectId,
                    params.userId,
                    URL_PEOPLE_DETAILS_BACKLINKS_TASKS
                )
            case URL_PEOPLE_DETAILS_BACKLINKS_NOTES:
                return ContactsHelper.processURLPeopleDetailsTab(
                    navigation,
                    DV_TAB_USER_BACKLINKS,
                    params.projectId,
                    params.userId,
                    URL_PEOPLE_DETAILS_BACKLINKS_NOTES
                )
            case URL_PROJECT_PEOPLE_ADD:
                return ContactsHelper.processURLProjectPeopleAdd(navigation, params.projectId, params.userId)
        }
    }
}

export default URLsPeopleTrigger
