import { URL_NOT_MATCH } from '../URLSystemTrigger'
import {
    DV_TAB_ASSISTANT_BACKLINKS,
    DV_TAB_ASSISTANT_CHAT,
    DV_TAB_ASSISTANT_CUSTOMIZATIONS,
    DV_TAB_ASSISTANT_NOTE,
    DV_TAB_ASSISTANT_UPDATES,
} from '../../utils/TabNavigationConstants'
import {
    URL_ASSISTANT_DETAILS_CUSTOMIZATIONS,
    URL_ASSISTANT_DETAILS,
    URL_ASSISTANT_DETAILS_BACKLINKS_NOTES,
    URL_ASSISTANT_DETAILS_BACKLINKS_TASKS,
    URL_ASSISTANT_DETAILS_NOTE,
    URL_ASSISTANT_DETAILS_CHAT,
    URL_ASSISTANT_DETAILS_UPDATES,
} from './URLsAssistants'
import { AssistantDetailedViewHelper } from '../../components/AssistantDetailedView/AssistantDetailedViewHelper'

class URLsAssistantsTrigger {
    static getRegexList = () => {
        return {
            [URL_ASSISTANT_DETAILS]: new RegExp('^/projects/(?<projectId>[\\w-]+)/assistants/(?<assistantId>[\\w-]+)$'),
            [URL_ASSISTANT_DETAILS_CUSTOMIZATIONS]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/assistants/(?<assistantId>[\\w-]+)/customizations$'
            ),
            [URL_ASSISTANT_DETAILS_BACKLINKS_TASKS]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/assistants/(?<assistantId>[\\w-]+)/backlinks/tasks$'
            ),
            [URL_ASSISTANT_DETAILS_BACKLINKS_NOTES]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/assistants/(?<assistantId>[\\w-]+)/backlinks/notes$'
            ),
            [URL_ASSISTANT_DETAILS_NOTE]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/assistants/(?<assistantId>[\\w-]+)/note$'
            ),
            [URL_ASSISTANT_DETAILS_CHAT]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/assistants/(?<assistantId>[\\w-]+)/chat$'
            ),
            [URL_ASSISTANT_DETAILS_UPDATES]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/assistants/(?<assistantId>[\\w-]+)/updates$'
            ),
        }
    }

    static match = pathname => {
        const regexList = URLsAssistantsTrigger.getRegexList()

        for (let key in regexList) {
            const matchObj = pathname.match(regexList[key])

            if (matchObj) {
                return { key: key, matches: matchObj }
            }
        }

        return URL_NOT_MATCH
    }

    static trigger = (navigation, pathname) => {
        const matchedObj = URLsAssistantsTrigger.match(pathname)
        const params = matchedObj.matches.groups

        // This Switch will have CASEs as elements have the "regexList" const
        switch (matchedObj.key) {
            case URL_ASSISTANT_DETAILS:
                return AssistantDetailedViewHelper(
                    navigation,
                    DV_TAB_ASSISTANT_CUSTOMIZATIONS,
                    params.assistantId,
                    params.projectId,
                    null
                )
            case URL_ASSISTANT_DETAILS_CUSTOMIZATIONS:
                return AssistantDetailedViewHelper(
                    navigation,
                    DV_TAB_ASSISTANT_CUSTOMIZATIONS,
                    params.assistantId,
                    params.projectId,
                    null
                )
            case URL_ASSISTANT_DETAILS_BACKLINKS_TASKS:
                return AssistantDetailedViewHelper(
                    navigation,
                    DV_TAB_ASSISTANT_BACKLINKS,
                    params.assistantId,
                    params.projectId,
                    URL_ASSISTANT_DETAILS_BACKLINKS_TASKS
                )
            case URL_ASSISTANT_DETAILS_BACKLINKS_NOTES:
                return AssistantDetailedViewHelper(
                    navigation,
                    DV_TAB_ASSISTANT_BACKLINKS,
                    params.assistantId,
                    params.projectId,
                    URL_ASSISTANT_DETAILS_BACKLINKS_NOTES
                )
            case URL_ASSISTANT_DETAILS_NOTE:
                return AssistantDetailedViewHelper(
                    navigation,
                    DV_TAB_ASSISTANT_NOTE,
                    params.assistantId,
                    params.projectId,
                    null
                )
            case URL_ASSISTANT_DETAILS_CHAT:
                return AssistantDetailedViewHelper(
                    navigation,
                    DV_TAB_ASSISTANT_CHAT,
                    params.assistantId,
                    params.projectId,
                    null
                )
            case URL_ASSISTANT_DETAILS_UPDATES:
                return AssistantDetailedViewHelper(
                    navigation,
                    DV_TAB_ASSISTANT_UPDATES,
                    params.assistantId,
                    params.projectId,
                    null
                )
        }
    }
}

export default URLsAssistantsTrigger
