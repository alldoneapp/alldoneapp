import { URL_NOT_MATCH } from '../URLSystemTrigger'
import {
    URL_SKILL_DETAILS,
    URL_SKILL_DETAILS_BACKLINKS_NOTES,
    URL_SKILL_DETAILS_BACKLINKS_TASKS,
    URL_SKILL_DETAILS_PROPERTIES,
    URL_SKILL_DETAILS_NOTE,
    URL_SKILL_DETAILS_CHAT,
    URL_SKILL_DETAILS_FEED,
} from './URLsSkills'
import TasksHelper from '../../components/TaskListView/Utils/TasksHelper'
import {
    DV_TAB_SKILL_BACKLINKS,
    DV_TAB_SKILL_CHAT,
    DV_TAB_SKILL_PROPERTIES,
    DV_TAB_SKILL_UPDATES,
    DV_TAB_SKILL_NOTE,
} from '../../utils/TabNavigationConstants'

class URLsSkillsTrigger {
    static getRegexList = () => {
        return {
            [URL_SKILL_DETAILS]: new RegExp('^/projects/(?<projectId>[\\w-]+)/skills/(?<skillId>[\\w-]+)$'),
            [URL_SKILL_DETAILS_FEED]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/skills/(?<skillId>[\\w-]+)/updates$'
            ),
            [URL_SKILL_DETAILS_PROPERTIES]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/skills/(?<skillId>[\\w-]+)/properties$'
            ),
            [URL_SKILL_DETAILS_NOTE]: new RegExp('^/projects/(?<projectId>[\\w-]+)/skills/(?<skillId>[\\w-]+)/note$'),
            [URL_SKILL_DETAILS_BACKLINKS_TASKS]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/skills/(?<skillId>[\\w-]+)/backlinks/tasks$'
            ),
            [URL_SKILL_DETAILS_BACKLINKS_NOTES]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/skills/(?<skillId>[\\w-]+)/backlinks/notes$'
            ),
            [URL_SKILL_DETAILS_CHAT]: new RegExp('^/projects/(?<projectId>[\\w-]+)/skills/(?<skillId>[\\w-]+)/chat$'),
        }
    }

    static match = pathname => {
        const regexList = URLsSkillsTrigger.getRegexList()

        for (let key in regexList) {
            const matchObj = pathname.match(regexList[key])

            if (matchObj) {
                return { key: key, matches: matchObj }
            }
        }

        return URL_NOT_MATCH
    }

    static trigger = (navigation, pathname) => {
        const matchedObj = URLsSkillsTrigger.match(pathname)
        const params = matchedObj.matches.groups

        // This Switch will have CASEs as elements have the "regexList" const
        switch (matchedObj.key) {
            case URL_SKILL_DETAILS:
                return TasksHelper.processURLSkillDetails(navigation, params.projectId, params.skillId)
            case URL_SKILL_DETAILS_FEED:
                return TasksHelper.processURLSkillDetailsTab(
                    navigation,
                    DV_TAB_SKILL_UPDATES,
                    params.projectId,
                    params.skillId
                )
            case URL_SKILL_DETAILS_PROPERTIES:
                return TasksHelper.processURLSkillDetailsTab(
                    navigation,
                    DV_TAB_SKILL_PROPERTIES,
                    params.projectId,
                    params.skillId
                )
            case URL_SKILL_DETAILS_NOTE:
                return TasksHelper.processURLSkillDetailsTab(
                    navigation,
                    DV_TAB_SKILL_NOTE,
                    params.projectId,
                    params.skillId
                )
            case URL_SKILL_DETAILS_CHAT:
                return TasksHelper.processURLSkillDetailsTab(
                    navigation,
                    DV_TAB_SKILL_CHAT,
                    params.projectId,
                    params.skillId
                )
            case URL_SKILL_DETAILS_BACKLINKS_TASKS:
                return TasksHelper.processURLSkillDetailsTab(
                    navigation,
                    DV_TAB_SKILL_BACKLINKS,
                    params.projectId,
                    params.skillId,
                    URL_SKILL_DETAILS_BACKLINKS_TASKS
                )
            case URL_SKILL_DETAILS_BACKLINKS_NOTES:
                return TasksHelper.processURLSkillDetailsTab(
                    navigation,
                    DV_TAB_SKILL_BACKLINKS,
                    params.projectId,
                    params.skillId,
                    URL_SKILL_DETAILS_BACKLINKS_NOTES
                )
        }
    }
}

export default URLsSkillsTrigger
