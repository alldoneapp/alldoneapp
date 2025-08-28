import { URL_NOT_MATCH } from '../URLSystemTrigger'
import {
    URL_ALL_PROJECTS_TASKS,
    URL_ALL_PROJECTS_TASKS_DONE,
    URL_ALL_PROJECTS_TASKS_OPEN,
    URL_ALL_PROJECTS_TASKS_WORKFLOW,
    URL_PROJECT_USER_TASKS,
    URL_PROJECT_USER_TASKS_DONE,
    URL_PROJECT_USER_TASKS_OPEN,
    URL_PROJECT_USER_TASKS_WORKFLOW,
    URL_PROJECT_USER_TASKS_IN_PROGRESS,
    URL_ROOT,
    URL_TASK_DETAILS,
    URL_TASK_DETAILS_BACKLINKS_NOTES,
    URL_TASK_DETAILS_BACKLINKS_TASKS,
    URL_TASK_DETAILS_CHAT,
    URL_TASK_DETAILS_ESTIMATION,
    URL_TASK_DETAILS_FEED,
    URL_TASK_DETAILS_NOTE,
    URL_TASK_DETAILS_PROPERTIES,
    URL_TASK_DETAILS_SUBTASKS,
} from './URLsTasks'
import TasksHelper from '../../components/TaskListView/Utils/TasksHelper'
import {
    DV_TAB_TASK_BACKLINKS,
    DV_TAB_TASK_CHAT,
    DV_TAB_TASK_ESTIMATIONS,
    DV_TAB_TASK_NOTE,
    DV_TAB_TASK_PROPERTIES,
    DV_TAB_TASK_SUBTASKS,
    DV_TAB_TASK_UPDATES,
} from '../../utils/TabNavigationConstants'

class URLsTasksTrigger {
    static getRegexList = () => {
        return {
            [URL_ROOT]: new RegExp('^/+$'),
            [URL_ALL_PROJECTS_TASKS]: new RegExp('^/projects/tasks$'),
            [URL_ALL_PROJECTS_TASKS_OPEN]: new RegExp('^/projects/tasks/open$'),
            [URL_ALL_PROJECTS_TASKS_WORKFLOW]: new RegExp('^/projects/tasks/workflow$'),
            [URL_ALL_PROJECTS_TASKS_DONE]: new RegExp('^/projects/tasks/done$'),
            [URL_PROJECT_USER_TASKS]: new RegExp('^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w@-]+)/tasks$'),
            [URL_PROJECT_USER_TASKS_OPEN]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w@-]+)/tasks/open$'
            ),
            [URL_PROJECT_USER_TASKS_WORKFLOW]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w@-]+)/tasks/workflow$'
            ),
            [URL_PROJECT_USER_TASKS_IN_PROGRESS]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w@-]+)/tasks/inProgress$'
            ),
            [URL_PROJECT_USER_TASKS_DONE]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/user/(?<userId>[\\w@-]+)/tasks/done$'
            ),
            [URL_TASK_DETAILS]: new RegExp('^/projects/(?<projectId>[\\w-]+)/tasks/(?<taskId>[\\w-]+)$'),
            [URL_TASK_DETAILS_FEED]: new RegExp('^/projects/(?<projectId>[\\w-]+)/tasks/(?<taskId>[\\w-]+)/updates$'),
            [URL_TASK_DETAILS_ESTIMATION]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/tasks/(?<taskId>[\\w-]+)/estimation$'
            ),
            [URL_TASK_DETAILS_PROPERTIES]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/tasks/(?<taskId>[\\w-]+)/properties$'
            ),
            [URL_TASK_DETAILS_CHAT]: new RegExp('^/projects/(?<projectId>[\\w-]+)/tasks/(?<taskId>[\\w-]+)/chat$'),
            [URL_TASK_DETAILS_NOTE]: new RegExp('^/projects/(?<projectId>[\\w-]+)/tasks/(?<taskId>[\\w-]+)/note$'),
            [URL_TASK_DETAILS_SUBTASKS]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/tasks/(?<taskId>[\\w-]+)/subtasks$'
            ),
            [URL_TASK_DETAILS_BACKLINKS_TASKS]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/tasks/(?<taskId>[\\w-]+)/backlinks/tasks$'
            ),
            [URL_TASK_DETAILS_BACKLINKS_NOTES]: new RegExp(
                '^/projects/(?<projectId>[\\w-]+)/tasks/(?<taskId>[\\w-]+)/backlinks/notes$'
            ),
        }
    }

    static match = pathname => {
        const TASK_REGEX_LIST = URLsTasksTrigger.getRegexList()

        for (let key in TASK_REGEX_LIST) {
            const matchObj = pathname.match(TASK_REGEX_LIST[key])

            if (matchObj) {
                return { key: key, matches: matchObj }
            }
        }

        return URL_NOT_MATCH
    }

    static urlPointToJoinLogic(pathname) {
        const urlMatchingForJoinUser = [
            URL_PROJECT_USER_TASKS,
            URL_PROJECT_USER_TASKS_OPEN,
            URL_PROJECT_USER_TASKS_WORKFLOW,
            URL_PROJECT_USER_TASKS_DONE,
        ]

        const matchedObj = URLsTasksTrigger.match(pathname)

        return urlMatchingForJoinUser.includes(matchedObj.key)
    }

    static trigger = (navigation, pathname) => {
        const matchedObj = URLsTasksTrigger.match(pathname)
        const params = matchedObj.matches.groups

        // This Switch will have CASEs as elements have the "TASK_REGEX_LIST" const
        switch (matchedObj.key) {
            case URL_ROOT:
                return TasksHelper.processURLAllProjectsTasks(navigation)
            case URL_ALL_PROJECTS_TASKS:
                return TasksHelper.processURLAllProjectsTasks(navigation)
            case URL_ALL_PROJECTS_TASKS_OPEN:
                return TasksHelper.processURLAllProjectsTasks(navigation, URL_ALL_PROJECTS_TASKS_OPEN)
            case URL_ALL_PROJECTS_TASKS_WORKFLOW:
                return TasksHelper.processURLAllProjectsTasks(navigation, URL_ALL_PROJECTS_TASKS_WORKFLOW)
            case URL_ALL_PROJECTS_TASKS_DONE:
                return TasksHelper.processURLAllProjectsTasks(navigation, URL_ALL_PROJECTS_TASKS_DONE)
            case URL_PROJECT_USER_TASKS:
                return TasksHelper.processURLProjectsUserTasks(navigation, params.projectId, params.userId)
            case URL_PROJECT_USER_TASKS_OPEN:
                return TasksHelper.processURLProjectsUserTasks(
                    navigation,
                    params.projectId,
                    params.userId,
                    URL_PROJECT_USER_TASKS_OPEN
                )
            case URL_PROJECT_USER_TASKS_WORKFLOW:
                return TasksHelper.processURLProjectsUserTasks(
                    navigation,
                    params.projectId,
                    params.userId,
                    URL_PROJECT_USER_TASKS_WORKFLOW
                )
            case URL_PROJECT_USER_TASKS_IN_PROGRESS:
                return TasksHelper.processURLProjectsUserTasks(
                    navigation,
                    params.projectId,
                    params.userId,
                    URL_PROJECT_USER_TASKS_IN_PROGRESS
                )
            case URL_PROJECT_USER_TASKS_DONE:
                return TasksHelper.processURLProjectsUserTasks(
                    navigation,
                    params.projectId,
                    params.userId,
                    URL_PROJECT_USER_TASKS_DONE
                )
            case URL_TASK_DETAILS:
                return TasksHelper.processURLTaskDetails(navigation, params.projectId, params.taskId)
            case URL_TASK_DETAILS_FEED:
                return TasksHelper.processURLTaskDetailsTab(
                    navigation,
                    DV_TAB_TASK_UPDATES,
                    params.projectId,
                    params.taskId
                )
            case URL_TASK_DETAILS_ESTIMATION:
                return TasksHelper.processURLTaskDetailsTab(
                    navigation,
                    DV_TAB_TASK_ESTIMATIONS,
                    params.projectId,
                    params.taskId
                )
            case URL_TASK_DETAILS_PROPERTIES:
                return TasksHelper.processURLTaskDetailsTab(
                    navigation,
                    DV_TAB_TASK_PROPERTIES,
                    params.projectId,
                    params.taskId
                )
            case URL_TASK_DETAILS_CHAT:
                return TasksHelper.processURLTaskDetailsTab(
                    navigation,
                    DV_TAB_TASK_CHAT,
                    params.projectId,
                    params.taskId
                )
            case URL_TASK_DETAILS_NOTE:
                return TasksHelper.processURLTaskDetailsTab(
                    navigation,
                    DV_TAB_TASK_NOTE,
                    params.projectId,
                    params.taskId
                )
            case URL_TASK_DETAILS_SUBTASKS:
                return TasksHelper.processURLTaskDetailsTab(
                    navigation,
                    DV_TAB_TASK_SUBTASKS,
                    params.projectId,
                    params.taskId
                )
            case URL_TASK_DETAILS_BACKLINKS_TASKS:
                return TasksHelper.processURLTaskDetailsTab(
                    navigation,
                    DV_TAB_TASK_BACKLINKS,
                    params.projectId,
                    params.taskId,
                    URL_TASK_DETAILS_BACKLINKS_TASKS
                )
            case URL_TASK_DETAILS_BACKLINKS_NOTES:
                return TasksHelper.processURLTaskDetailsTab(
                    navigation,
                    DV_TAB_TASK_BACKLINKS,
                    params.projectId,
                    params.taskId,
                    URL_TASK_DETAILS_BACKLINKS_NOTES
                )
        }
    }
}

export default URLsTasksTrigger
