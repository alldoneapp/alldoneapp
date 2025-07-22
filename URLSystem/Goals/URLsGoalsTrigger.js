import { URL_NOT_MATCH } from '../URLSystemTrigger'
import {
    URL_ALL_PROJECTS_GOALS,
    URL_ALL_PROJECTS_GOALS_DONE,
    URL_ALL_PROJECTS_GOALS_OPEN,
    URL_GOAL_DETAILS,
    URL_GOAL_DETAILS_BACKLINKS_NOTES,
    URL_GOAL_DETAILS_BACKLINKS_TASKS,
    URL_GOAL_DETAILS_TASKS_OPEN,
    URL_GOAL_DETAILS_TASKS_WORKFLOW,
    URL_GOAL_DETAILS_TASKS_DONE,
    URL_GOAL_DETAILS_PROPERTIES,
    URL_GOAL_DETAILS_NOTE,
    URL_GOAL_DETAILS_CHAT,
    URL_PROJECT_USER_GOALS,
    URL_PROJECT_USER_GOALS_DONE,
    URL_PROJECT_USER_GOALS_OPEN,
    URL_GOAL_DETAILS_FEED,
    URL_GOAL_DETAILS_LINKED_TASKS,
} from './URLsGoals'
import TasksHelper from '../../components/TaskListView/Utils/TasksHelper'
import {
    DV_TAB_GOAL_BACKLINKS,
    DV_TAB_GOAL_CHAT,
    DV_TAB_GOAL_PROPERTIES,
    DV_TAB_GOAL_UPDATES,
    DV_TAB_GOAL_LINKED_TASKS,
    DV_TAB_GOAL_NOTE,
} from '../../utils/TabNavigationConstants'
import SharedHelper from '../../utils/SharedHelper'
import store from '../../redux/store'

class URLsGoalsTrigger {
    static getRegexList = () => {
        return {
            [URL_ALL_PROJECTS_GOALS]: new RegExp('^/projects/goals$'),
            [URL_ALL_PROJECTS_GOALS_OPEN]: new RegExp('^/projects/goals/open$'),
            [URL_ALL_PROJECTS_GOALS_DONE]: new RegExp('^/projects/goals/done$'),
            [URL_PROJECT_USER_GOALS_OPEN]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w@-]+)/goals/open$'
            ),
            [URL_PROJECT_USER_GOALS_DONE]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w@-]+)/goals/done$'
            ),

            [URL_GOAL_DETAILS]: new RegExp('^/projects/(?<projectId>[\\w-]+)/goals/(?<goalId>[\\w-]+)$'),
            [URL_GOAL_DETAILS_FEED]: new RegExp('^/projects/(?<projectId>[\\w-]+)/goals/(?<goalId>[\\w-]+)/updates$'),
            [URL_GOAL_DETAILS_PROPERTIES]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/goals/(?<goalId>[\\w-]+)/properties$'
            ),
            [URL_GOAL_DETAILS_NOTE]: new RegExp('^/projects/(?<projectId>[\\w-]+)/goals/(?<goalId>[\\w-]+)/note$'),
            [URL_GOAL_DETAILS_BACKLINKS_TASKS]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/goals/(?<goalId>[\\w-]+)/backlinks/tasks$'
            ),
            [URL_GOAL_DETAILS_BACKLINKS_NOTES]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/goals/(?<goalId>[\\w-]+)/backlinks/notes$'
            ),
            [URL_GOAL_DETAILS_CHAT]: new RegExp('^/projects/(?<projectId>[\\w-]+)/goals/(?<goalId>[\\w-]+)/chat$'),
            [URL_GOAL_DETAILS_LINKED_TASKS]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/goals/(?<goalId>[\\w-]+)/tasks$'
            ),
            [URL_GOAL_DETAILS_TASKS_OPEN]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/goals/(?<goalId>[\\w-]+)/tasks/open$'
            ),
            [URL_GOAL_DETAILS_TASKS_WORKFLOW]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/goals/(?<goalId>[\\w-]+)/tasks/workflow$'
            ),
            [URL_GOAL_DETAILS_TASKS_DONE]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/goals/(?<goalId>[\\w-]+)/tasks/done$'
            ),
        }
    }

    static match = pathname => {
        const regexList = URLsGoalsTrigger.getRegexList()

        for (let key in regexList) {
            const matchObj = pathname.match(regexList[key])

            if (matchObj) {
                return { key: key, matches: matchObj }
            }
        }

        return URL_NOT_MATCH
    }

    static urlPointToJoinLogic(pathname) {
        const urlMatchingForJoinUser = [
            URL_PROJECT_USER_GOALS,
            URL_PROJECT_USER_GOALS_OPEN,
            URL_PROJECT_USER_GOALS_DONE,
        ]

        const matchedObj = URLsGoalsTrigger.match(pathname)

        return urlMatchingForJoinUser.includes(matchedObj.key)
    }

    static trigger = (navigation, pathname) => {
        const matchedObj = URLsGoalsTrigger.match(pathname)
        const params = matchedObj.matches.groups

        // This Switch will have CASEs as elements have the "regexList" const
        switch (matchedObj.key) {
            case URL_ALL_PROJECTS_GOALS:
                return TasksHelper.processURLAllProjectsGoals(navigation)
            case URL_ALL_PROJECTS_GOALS_OPEN:
                return TasksHelper.processURLAllProjectsGoals(navigation, URL_ALL_PROJECTS_GOALS_OPEN)
            case URL_ALL_PROJECTS_GOALS_DONE:
                return TasksHelper.processURLAllProjectsGoals(navigation, URL_ALL_PROJECTS_GOALS_DONE)
            case URL_PROJECT_USER_GOALS:
                return TasksHelper.processURLProjectsUserGoals(navigation, params.projectId, params.userId)
            case URL_PROJECT_USER_GOALS_OPEN:
                return TasksHelper.processURLProjectsUserGoals(
                    navigation,
                    params.projectId,
                    params.userId,
                    URL_PROJECT_USER_GOALS_OPEN
                )
            case URL_PROJECT_USER_GOALS_DONE:
                return TasksHelper.processURLProjectsUserGoals(
                    navigation,
                    params.projectId,
                    params.userId,
                    URL_PROJECT_USER_GOALS_DONE
                )
            case URL_GOAL_DETAILS:
                return TasksHelper.processURLGoalDetails(navigation, params.projectId, params.goalId)
            case URL_GOAL_DETAILS_FEED:
                return TasksHelper.processURLGoalDetailsTab(
                    navigation,
                    DV_TAB_GOAL_UPDATES,
                    params.projectId,
                    params.goalId
                )
            case URL_GOAL_DETAILS_PROPERTIES:
                return TasksHelper.processURLGoalDetailsTab(
                    navigation,
                    DV_TAB_GOAL_PROPERTIES,
                    params.projectId,
                    params.goalId
                )
            case URL_GOAL_DETAILS_NOTE:
                return TasksHelper.processURLGoalDetailsTab(
                    navigation,
                    DV_TAB_GOAL_NOTE,
                    params.projectId,
                    params.goalId
                )
            case URL_GOAL_DETAILS_CHAT:
                return TasksHelper.processURLGoalDetailsTab(
                    navigation,
                    DV_TAB_GOAL_CHAT,
                    params.projectId,
                    params.goalId
                )
            case URL_GOAL_DETAILS_LINKED_TASKS:
                return TasksHelper.processURLGoalDetailsTab(
                    navigation,
                    DV_TAB_GOAL_LINKED_TASKS,
                    params.projectId,
                    params.goalId
                )
            case URL_GOAL_DETAILS_BACKLINKS_TASKS:
                return TasksHelper.processURLGoalDetailsTab(
                    navigation,
                    DV_TAB_GOAL_BACKLINKS,
                    params.projectId,
                    params.goalId,
                    URL_GOAL_DETAILS_BACKLINKS_TASKS
                )
            case URL_GOAL_DETAILS_BACKLINKS_NOTES:
                return TasksHelper.processURLGoalDetailsTab(
                    navigation,
                    DV_TAB_GOAL_BACKLINKS,
                    params.projectId,
                    params.goalId,
                    URL_GOAL_DETAILS_BACKLINKS_NOTES
                )
            case URL_GOAL_DETAILS_TASKS_OPEN:
                return TasksHelper.processURLGoalDetailsTab(
                    navigation,
                    DV_TAB_GOAL_LINKED_TASKS,
                    params.projectId,
                    params.goalId,
                    URL_GOAL_DETAILS_TASKS_OPEN
                )
            case URL_GOAL_DETAILS_TASKS_WORKFLOW:
                return TasksHelper.processURLGoalDetailsTab(
                    navigation,
                    DV_TAB_GOAL_LINKED_TASKS,
                    params.projectId,
                    params.goalId,
                    URL_GOAL_DETAILS_TASKS_WORKFLOW
                )
            case URL_GOAL_DETAILS_TASKS_DONE:
                return TasksHelper.processURLGoalDetailsTab(
                    navigation,
                    DV_TAB_GOAL_LINKED_TASKS,
                    params.projectId,
                    params.goalId,
                    URL_GOAL_DETAILS_TASKS_DONE
                )
        }
    }
}

export default URLsGoalsTrigger
