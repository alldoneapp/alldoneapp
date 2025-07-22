import {
    URL_CONTACT_DETAILS,
    URL_CONTACT_DETAILS_BACKLINKS_NOTES,
    URL_CONTACT_DETAILS_BACKLINKS_TASKS,
    URL_CONTACT_DETAILS_FEED,
    URL_CONTACT_DETAILS_PROPERTIES,
    URL_CONTACT_DETAILS_CHAT,
    URL_CONTACT_DETAILS_NOTE,
} from './URLsContacts'
import { URL_NOT_MATCH } from '../URLSystemTrigger'
import ContactsHelper from '../../components/ContactsView/Utils/ContactsHelper'
import {
    DV_TAB_CONTACT_BACKLINKS,
    DV_TAB_CONTACT_PROPERTIES,
    DV_TAB_CONTACT_UPDATES,
    DV_TAB_CONTACT_CHAT,
    DV_TAB_CONTACT_NOTE,
} from '../../utils/TabNavigationConstants'

class URLsContactsTrigger {
    static getRegexList = () => {
        return {
            [URL_CONTACT_DETAILS]: new RegExp('^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)$'),
            [URL_CONTACT_DETAILS_PROPERTIES]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/properties$'
            ),
            [URL_CONTACT_DETAILS_FEED]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/updates$'
            ),
            [URL_CONTACT_DETAILS_BACKLINKS_TASKS]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/backlinks/tasks$'
            ),
            [URL_CONTACT_DETAILS_BACKLINKS_NOTES]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/backlinks/notes$'
            ),
            [URL_CONTACT_DETAILS_CHAT]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/chat$'
            ),
            [URL_CONTACT_DETAILS_NOTE]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/contacts/(?<userId>[\\w-]+)/note$'
            ),
        }
    }

    static match = pathname => {
        const regexList = URLsContactsTrigger.getRegexList()

        for (let key in regexList) {
            const matchObj = pathname.match(regexList[key])

            if (matchObj) {
                return { key: key, matches: matchObj }
            }
        }

        return URL_NOT_MATCH
    }

    static trigger = (navigation, pathname) => {
        const matchedObj = URLsContactsTrigger.match(pathname)
        const params = matchedObj.matches.groups

        // This Switch will have CASEs as elements have the "regexList" const
        switch (matchedObj.key) {
            case URL_CONTACT_DETAILS:
                return ContactsHelper.processURLContactDetails(navigation, params.projectId, params.userId)
            case URL_CONTACT_DETAILS_PROPERTIES:
                return ContactsHelper.processURLContactDetailsTab(
                    navigation,
                    DV_TAB_CONTACT_PROPERTIES,
                    params.projectId,
                    params.userId
                )
            case URL_CONTACT_DETAILS_CHAT:
                return ContactsHelper.processURLContactDetailsTab(
                    navigation,
                    DV_TAB_CONTACT_CHAT,
                    params.projectId,
                    params.userId
                )
            case URL_CONTACT_DETAILS_NOTE:
                return ContactsHelper.processURLContactDetailsTab(
                    navigation,
                    DV_TAB_CONTACT_NOTE,
                    params.projectId,
                    params.userId
                )
            case URL_CONTACT_DETAILS_FEED:
                return ContactsHelper.processURLContactDetailsTab(
                    navigation,
                    DV_TAB_CONTACT_UPDATES,
                    params.projectId,
                    params.userId
                )
            case URL_CONTACT_DETAILS_BACKLINKS_TASKS:
                return ContactsHelper.processURLContactDetailsTab(
                    navigation,
                    DV_TAB_CONTACT_BACKLINKS,
                    params.projectId,
                    params.userId,
                    URL_CONTACT_DETAILS_BACKLINKS_TASKS
                )
            case URL_CONTACT_DETAILS_BACKLINKS_NOTES:
                return ContactsHelper.processURLContactDetailsTab(
                    navigation,
                    DV_TAB_CONTACT_BACKLINKS,
                    params.projectId,
                    params.userId,
                    URL_CONTACT_DETAILS_BACKLINKS_NOTES
                )
        }
    }
}

export default URLsContactsTrigger
