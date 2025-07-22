import momentTz from 'moment-timezone'

import { URL_NOT_MATCH } from '../URLSystem/URLSystemTrigger'
import URLsTasks, {
    URL_ALL_PROJECTS_TASKS_OPEN,
    URL_PROJECT_USER_TASKS,
    URL_TASK_DETAILS,
} from '../URLSystem/Tasks/URLsTasks'
import { URL_NOTE_DETAILS } from '../URLSystem/Notes/URLsNotes'
import URLsTasksTrigger from '../URLSystem/Tasks/URLsTasksTrigger'
import URLsNotesTrigger from '../URLSystem/Notes/URLsNotesTrigger'
import Backend from './BackendBridge'
import store from '../redux/store'
import {
    setLastVisitedScreen,
    setShowAccessDeniedPopup,
    showFloatPopup,
    navigateToAllProjectsTasks,
} from '../redux/actions'
import URLTrigger from '../URLSystem/URLTrigger'
import NavigationService from './NavigationService'
import ProjectHelper, { PROJECT_PRIVATE } from '../components/SettingsView/ProjectsSettings/ProjectHelper'
import URLsContactsTrigger from '../URLSystem/Contacts/URLsContactsTrigger'
import { URL_CONTACT_DETAILS } from '../URLSystem/Contacts/URLsContacts'
import URLsGoalsTrigger from '../URLSystem/Goals/URLsGoalsTrigger'
import { URL_GOAL_DETAILS, URL_PROJECT_USER_GOALS } from '../URLSystem/Goals/URLsGoals'
import URLsPeopleTrigger from '../URLSystem/People/URLsPeopleTrigger'
import { URL_PEOPLE_DETAILS } from '../URLSystem/People/URLsPeople'
import { COLORS_THEME_MODERN } from '../Themes/Themes'
import { SIDEBAR_COLLAPSED } from '../components/SidebarMenu/Collapsible/CollapsibleHelper'
import { getDeviceLanguage } from '../i18n/TranslationService'
import { WORKSTREAM_ID_PREFIX } from '../components/Workstreams/WorkstreamHelper'
import SettingsHelper from '../components/SettingsView/SettingsHelper'
import URLsProjectsTrigger from '../URLSystem/Projects/URLsProjectsTrigger'
import { URL_PROJECT_DETAILS } from '../URLSystem/Projects/URLsProjects'
import { URL_SKILL_DETAILS } from '../URLSystem/Skills/URLsSkills'
import URLsSkillsTrigger from '../URLSystem/Skills/URLsSkillsTrigger'
import { getNoteMeta, getProjectData, getTaskData, loginWithGoogleWebAnonymously } from './backends/firestore'
import { ALL_GOALS_ID, allGoals } from '../components/AllSections/allSectionHelper'
import URLsChatsTrigger from '../URLSystem/Chats/URLsChatsTrigger'
import { URL_CHAT_DETAILS } from '../URLSystem/Chats/URLsChats'
import URLsAssistantsTrigger from '../URLSystem/Assistants/URLsAssistantsTrigger'
import { URL_ASSISTANT_DETAILS } from '../URLSystem/Assistants/URLsAssistants'
import { getAssistantData } from './backends/Assistants/assistantsFirestore'
import { getDvLink } from './LinkingHelper'
import { getSkillData } from './backends/Skills/skillsFirestore'
import { getWorkstreamData } from './backends/Workstreams/workstreamsFirestore'
import { getContactData } from './backends/Contacts/contactsFirestore'
import { getUserData } from './backends/Users/usersFirestore'
import { loadInitialDataForShared } from './InitialLoad/sharedProjectHelper'
import { loadInitialDataForAnonymous } from './InitialLoad/anonymousUserHelper'
import { GLOBAL_PROJECT_ID } from '../components/AdminPanel/Assistants/assistantsHelper'
import { FEED_PUBLIC_FOR_ALL } from '../components/Feeds/Utils/FeedsConstants'
import { getGoalData } from './backends/Goals/goalsFirestore'
import { getChatMeta } from './backends/Chats/chatsFirestore'

class SharedHelper {
    static processUrl = async (isLoggedIn, URL, onIsMember, onIsShared, onNotShared, onNotMatch, onJoinToTemplate) => {
        const sharedMatchersList = [
            URLsTasksTrigger,
            URLsNotesTrigger,
            URLsContactsTrigger,
            URLsPeopleTrigger,
            URLsGoalsTrigger,
            URLsProjectsTrigger,
            URLsSkillsTrigger,
            URLsChatsTrigger,
            URLsAssistantsTrigger,
        ]

        const getMatchedSharedObject = URL => {
            let matchedSharedObj = URL_NOT_MATCH
            for (let key in sharedMatchersList) {
                matchedSharedObj = sharedMatchersList[key].match(URL)
                if (matchedSharedObj !== URL_NOT_MATCH) break
            }
            return matchedSharedObj
        }

        const matchedSharedObj = getMatchedSharedObject(URL)

        const matchAnyResource = matchedSharedObj => {
            return (
                matchedSharedObj !== URL_NOT_MATCH &&
                (matchedSharedObj.key.indexOf(URL_TASK_DETAILS) >= 0 ||
                    matchedSharedObj.key.indexOf(URL_PROJECT_USER_TASKS) >= 0 ||
                    matchedSharedObj.key.indexOf(URL_GOAL_DETAILS) >= 0 ||
                    matchedSharedObj.key.indexOf(URL_PROJECT_USER_GOALS) >= 0 ||
                    matchedSharedObj.key.indexOf(URL_NOTE_DETAILS) >= 0 ||
                    matchedSharedObj.key.indexOf(URL_CONTACT_DETAILS) >= 0 ||
                    matchedSharedObj.key.indexOf(URL_PEOPLE_DETAILS) >= 0 ||
                    matchedSharedObj.key.indexOf(URL_PROJECT_DETAILS) >= 0 ||
                    matchedSharedObj.key.indexOf(URL_SKILL_DETAILS) >= 0 ||
                    matchedSharedObj.key.indexOf(URL_CHAT_DETAILS) >= 0 ||
                    matchedSharedObj.key.indexOf(URL_ASSISTANT_DETAILS) >= 0)
            )
        }

        const isAnonymous = !isLoggedIn

        if (matchAnyResource(matchedSharedObj)) {
            const params = matchedSharedObj.matches.groups

            if (isLoggedIn && SharedHelper.isMember(params.projectId)) {
                onIsMember(URL)
            } else {
                const isSharedResource = isLoggedIn

                if (isAnonymous) await loginWithGoogleWebAnonymously()

                switch (true) {
                    // Process task
                    case matchedSharedObj.key.indexOf(URL_TASK_DETAILS) >= 0: {
                        const promises = []
                        promises.push(getTaskData(params.projectId, params.taskId))
                        promises.push(getProjectData(params.projectId))
                        const [task, project] = await Promise.all(promises)
                        if (SharedHelper.canAccessToProject(project, false) && SharedHelper.canAccessToObject(task)) {
                            const user = await getUserData(task.creatorId, false)
                            const users = { projectUser: user, currentUser: user }
                            const commonPath = getDvLink(params.projectId, params.taskId, 'tasks')
                            await onIsShared(URL, users, params, commonPath)
                        } else {
                            await onNotShared()
                        }
                        break
                    }
                    // Process task list
                    case matchedSharedObj.key.indexOf(URL_PROJECT_USER_TASKS) >= 0: {
                        const project = await getProjectData(params.projectId)
                        if (SharedHelper.canAccessToProject(project, true)) {
                            if (project.isTemplate) {
                                if (isSharedResource) onJoinToTemplate()
                            } else if (project.parentTemplateId) {
                                if (isSharedResource) {
                                    const { loggedUser, administratorUser } = store.getState()
                                    const belognsToTemplate = loggedUser.realTemplateProjectIds.includes(
                                        project.parentTemplateId
                                    )
                                    const userIsAdministrator = administratorUser.uid === loggedUser.uid
                                    if (belognsToTemplate || userIsAdministrator) {
                                        const users = await SharedHelper.getUsersForHandleTasksAndGoalsBoards(
                                            project,
                                            params.userId
                                        )
                                        const commonPath = `/projects/${params.projectId}/user/${params.userId}/tasks`
                                        users.currentUser
                                            ? await onIsShared(URL, users, params, commonPath)
                                            : await onNotShared()
                                    } else {
                                        await onNotShared()
                                    }
                                } else {
                                    await onNotShared()
                                }
                            } else {
                                const users = await SharedHelper.getUsersForHandleTasksAndGoalsBoards(
                                    project,
                                    params.userId
                                )
                                const commonPath = `/projects/${params.projectId}/user/${params.userId}/tasks`
                                users.currentUser
                                    ? await onIsShared(URL, users, params, commonPath)
                                    : await onNotShared()
                            }
                        } else {
                            await onNotShared()
                        }
                        break
                    }
                    // Process goal
                    case matchedSharedObj.key.indexOf(URL_GOAL_DETAILS) >= 0: {
                        const promises = []
                        promises.push(getGoalData(params.projectId, params.goalId))
                        promises.push(getProjectData(params.projectId))
                        const [goal, project] = await Promise.all(promises)

                        if (SharedHelper.canAccessToProject(project, false) && SharedHelper.canAccessToObject(goal)) {
                            const user = await getUserData(goal.creatorId, false)
                            const users = { projectUser: user, currentUser: user }
                            const commonPath = getDvLink(params.projectId, params.goalId, 'goals')
                            await onIsShared(URL, users, params, commonPath)
                        } else {
                            await onNotShared()
                        }
                        break
                    }
                    // Process goal list
                    case matchedSharedObj.key.indexOf(URL_PROJECT_USER_GOALS) >= 0: {
                        const project = await Backend.getProjectData(params.projectId)
                        if (SharedHelper.canAccessToProject(project, true)) {
                            if (project.isTemplate) {
                                if (isSharedResource) onJoinToTemplate()
                            } else if (project.parentTemplateId) {
                                if (isSharedResource) {
                                    const { loggedUser, administratorUser } = store.getState()
                                    const belognsToTemplate = loggedUser.realTemplateProjectIds.includes(
                                        project.parentTemplateId
                                    )
                                    const userIsAdministrator = administratorUser.uid === loggedUser.uid
                                    if (belognsToTemplate || userIsAdministrator) {
                                        const users = await SharedHelper.getUsersForHandleTasksAndGoalsBoards(
                                            project,
                                            params.userId
                                        )
                                        const commonPath = `/projects/${params.projectId}/user/${params.userId}/tasks`
                                        users.currentUser
                                            ? await onIsShared(URL, users, params, commonPath)
                                            : await onNotShared()
                                    } else {
                                        await onNotShared()
                                    }
                                }
                            } else {
                                const users = await SharedHelper.getUsersForHandleTasksAndGoalsBoards(
                                    project,
                                    params.userId
                                )
                                const commonPath = `/projects/${params.projectId}/user/${params.userId}/goals`
                                users.currentUser
                                    ? await onIsShared(URL, users, params, commonPath)
                                    : await onNotShared()
                            }
                        } else {
                            await onNotShared()
                        }
                        break
                    }
                    // Process assistant
                    case matchedSharedObj.key.indexOf(URL_ASSISTANT_DETAILS) >= 0: {
                        if (params.projectId === GLOBAL_PROJECT_ID) {
                            const { loggedUser, administratorUser } = store.getState()
                            if (isLoggedIn && loggedUser.uid === administratorUser.uid) {
                                onIsMember(URL)
                            } else {
                                await onNotShared()
                            }
                        } else {
                            const promises = []
                            promises.push(getAssistantData(params.projectId, params.assistantId))
                            promises.push(getAssistantData(GLOBAL_PROJECT_ID, params.assistantId))
                            promises.push(getProjectData(params.projectId))
                            const [assistant, globalAssistant, project] = await Promise.all(promises)
                            if (
                                SharedHelper.canAccessToProject(project, false) &&
                                (assistant ||
                                    (globalAssistant && project.globalAssistantIds.includes(params.assistantId)))
                            ) {
                                const projectUserId = assistant ? assistant.creatorId : project.userIds[0]
                                const user = await getUserData(projectUserId, false)
                                const users = { projectUser: user, currentUser: user }
                                const commonPath = getDvLink(params.projectId, params.assistantId, 'assistants')
                                await onIsShared(URL, users, params, commonPath)
                            } else {
                                await onNotShared()
                            }
                        }
                        break
                    }
                    // Process note
                    case matchedSharedObj.key.indexOf(URL_NOTE_DETAILS) >= 0: {
                        const promises = []
                        promises.push(getNoteMeta(params.projectId, params.noteId))
                        promises.push(getProjectData(params.projectId))
                        const [note, project] = await Promise.all(promises)
                        if (SharedHelper.canAccessToProject(project, false) && SharedHelper.canAccessToObject(note)) {
                            const user = await getUserData(note.creatorId, false)
                            const users = { projectUser: user, currentUser: user }
                            const commonPath = getDvLink(params.projectId, params.noteId, 'notes')
                            await onIsShared(URL, users, params, commonPath)
                        } else {
                            await onNotShared()
                        }
                        break
                    }
                    // Process contact & users
                    case matchedSharedObj.key.indexOf(URL_CONTACT_DETAILS) >= 0 ||
                        matchedSharedObj.key.indexOf(URL_PEOPLE_DETAILS) >= 0: {
                        const promises = []
                        promises.push(getContactData(params.projectId, params.userId))
                        promises.push(getUserData(params.userId, false))
                        promises.push(getProjectData(params.projectId))
                        const [contact, user, project] = await Promise.all(promises)

                        if (SharedHelper.canAccessToProject(project, false)) {
                            if (user) {
                                const users = { projectUser: user, currentUser: user }
                                const commonPath = getDvLink(params.projectId, params.userId, 'users')
                                await onIsShared(URL, users, params, commonPath)
                            } else if (SharedHelper.canAccessToObject(contact)) {
                                const user = await getUserData(contact.recorderUserId, false)
                                const users = { projectUser: user, currentUser: user }
                                const commonPath = getDvLink(params.projectId, params.userId, 'contacts')
                                await onIsShared(URL, users, params, commonPath)
                            } else {
                                await onNotShared()
                            }
                        } else {
                            await onNotShared()
                        }
                        break
                    }
                    // Process skill
                    case matchedSharedObj.key.indexOf(URL_SKILL_DETAILS) >= 0: {
                        const promises = []
                        promises.push(getSkillData(params.projectId, params.skillId))
                        promises.push(getProjectData(params.projectId))
                        const [skill, project] = await Promise.all(promises)
                        if (SharedHelper.canAccessToProject(project, false) && SharedHelper.canAccessToObject(skill)) {
                            const user = await getUserData(skill.userId, false)
                            const users = { projectUser: user, currentUser: user }
                            const commonPath = getDvLink(params.projectId, params.skillId, 'skills')
                            await onIsShared(URL, users, params, commonPath)
                        } else {
                            await onNotShared()
                        }
                        break
                    }
                    // Process chat
                    case matchedSharedObj.key.indexOf(URL_CHAT_DETAILS) >= 0: {
                        const promises = []
                        promises.push(getChatMeta(params.projectId, params.chatId))
                        promises.push(getProjectData(params.projectId))
                        const [chat, project] = await Promise.all(promises)
                        if (SharedHelper.canAccessToProject(project, false) && SharedHelper.canAccessToObject(chat)) {
                            const user = await getUserData(chat.creatorId, false)
                            const users = { projectUser: user, currentUser: user }
                            const commonPath = getDvLink(params.projectId, params.chatId, 'chats')
                            await onIsShared(URL, users, params, commonPath)
                        } else {
                            await onNotShared()
                        }
                        break
                    }
                    // Process project dv
                    case matchedSharedObj.key.indexOf(URL_PROJECT_DETAILS) >= 0: {
                        const project = await getProjectData(params.projectId)
                        if (SharedHelper.canAccessToProject(project, false)) {
                            const user = await getUserData(project.userIds[0], false)
                            const users = { projectUser: user, currentUser: user }
                            const commonPath = getDvLink(params.projectId, params.projectId, 'projects')
                            await onIsShared(URL, users, params, commonPath)
                        } else {
                            await onNotShared()
                        }
                        break
                    }
                }
            }
        } else {
            if (!isAnonymous) {
                const matchersList = URLTrigger.getRegexList()

                for (let key in matchersList) {
                    if (matchersList[key].match(URL) !== URL_NOT_MATCH) {
                        onIsMember(URL)
                        return
                    }
                }
            }

            onNotMatch(URL)
        }
    }

    static processUrlAsAnonymous = async () => {
        const { initialUrl: URL } = store.getState()

        const onIsShared = async (URL, users, params, commonPath) => {
            await loadInitialDataForAnonymous(params.projectId, URL, users)
        }

        const onNotShared = () => {
            URLTrigger.directProcessUrl(NavigationService, '/private-resource')
        }

        const onNotMatch = URL => {
            // If URL is public then process it
            // We have public URLs: /login, /starttrial, and /paymentsuccess
            // The /login route is processed in other component, not here
            // For /starttrial and /paymentsuccess, we should handle them directly
            if (URL.startsWith('/starttrial') || URL.startsWith('/paymentsuccess')) {
                URLTrigger.directProcessUrl(NavigationService, URL)
            }
        }

        await SharedHelper.processUrl(false, URL, null, onIsShared, onNotShared, onNotMatch, null)
    }

    static processUrlAsLoggedIn = async (navigation, URL, backAction = false) => {
        const { loggedIn } = store.getState()
        const onIsMember = URL => {
            URLTrigger.directProcessUrl(navigation, URL)
        }

        const onNotMatch = () => {
            URLsTasks.replace(URL_ALL_PROJECTS_TASKS_OPEN)
            navigation.navigate('Root')
            store.dispatch(navigateToAllProjectsTasks())
        }

        const onIsShared = (URL, users, params, commonPath) => {
            if (backAction && SharedHelper.isCommonSharedPath(URL, commonPath)) {
                URLTrigger.directProcessUrl(navigation, URL)
            } else if (params.projectId) {
                loadInitialDataForShared(params.projectId, navigation, URL)
            }
        }

        const onNotShared = () => {
            store.dispatch([showFloatPopup(), setShowAccessDeniedPopup(true)])
            URLTrigger.directProcessUrl(navigation, '/projects/tasks/open')
        }

        const onJoinToTemplate = () => {
            URLTrigger.directProcessUrl(navigation, URL)
        }

        await SharedHelper.processUrl(loggedIn, URL, onIsMember, onIsShared, onNotShared, onNotMatch, onJoinToTemplate)
    }

    static isMember = (projectId, customUser) => {
        const { loggedUser } = store.getState()
        const { projectIds } = customUser || loggedUser
        return projectIds.includes(projectId)
    }

    static canAccessToObject = object => {
        return object && object.isPublicFor.includes(FEED_PUBLIC_FOR_ALL)
    }

    static canAccessToProject = (project, entryPointForJoinToProject) => {
        if (!project) return false

        const isPublic = project.isShared !== PROJECT_PRIVATE
        const isTemplate = project.isTemplate
        const isGuide = !!project.parentTemplateId

        return isPublic && (entryPointForJoinToProject || (!isTemplate && !isGuide))
    }

    static checkIfUserHasAccessToProject = (isAnonymous, userProjectIds, projectId, allowAnonymous) => {
        return (allowAnonymous || !isAnonymous) && userProjectIds.includes(projectId)
    }

    static accessGranted = (customUser, projectId, allowAnonymous = false) => {
        const { loggedUser } = store.getState()
        const user = customUser || loggedUser
        if (user.isAnonymous && !allowAnonymous) {
            return false
        } else if (!projectId || !ProjectHelper.getProjectById(projectId) || !SharedHelper.isMember(projectId, user)) {
            return false
        }

        return true
    }

    static isCommonSharedPath = (URL, commonPath) => {
        const currentURL = window.location.pathname
        const regex = new RegExp(commonPath)
        return !!currentURL.match(regex)
    }

    static redirectToPrivateResource = () => {
        Backend.logout(() => SettingsHelper.onLogOut(false))
        URLTrigger.directProcessUrl(NavigationService, '/private-resource')
    }

    static getUsersForHandleTasksAndGoalsBoards = async (project, resourceUserId) => {
        let projectUser = null
        let currentUser = null

        const userId = project.userIds[0]

        if (resourceUserId.startsWith(WORKSTREAM_ID_PREFIX)) {
            if (project.workstreamIds.includes(resourceUserId)) {
                const promises = []
                promises.push(getUserData(userId, false))
                promises.push(getWorkstreamData(project.id, resourceUserId))
                const [user, workstream] = await Promise.all(promises)
                projectUser = user
                currentUser = workstream
            }
        } else if (resourceUserId === ALL_GOALS_ID) {
            projectUser = await getUserData(userId, false)
            currentUser = allGoals
        } else if (project.globalAssistantIds.includes(resourceUserId)) {
            const promises = []
            promises.push(getUserData(userId, false))
            promises.push(getAssistantData(GLOBAL_PROJECT_ID, resourceUserId))
            const [user, globalAssistant] = await Promise.all(promises)
            projectUser = user
            currentUser = globalAssistant
        } else if (project.userIds.includes(resourceUserId)) {
            projectUser = await getUserData(resourceUserId, false)
            currentUser = projectUser
        } else {
            const promises = []
            promises.push(getUserData(userId, false))
            promises.push(getContactData(project.id, resourceUserId))
            promises.push(getAssistantData(project.id, resourceUserId))
            const [user, contact, assistant] = await Promise.all(promises)
            projectUser = user
            currentUser = contact || assistant
        }

        return { projectUser, currentUser }
    }

    static onHistoryPop = commonPath => {
        const { lastVisitedScreen } = store.getState()
        let path

        lastVisitedScreen.pop()

        const regex = new RegExp(commonPath)
        while (lastVisitedScreen.length > 0) {
            path = lastVisitedScreen.pop()
            if (!path.match(regex)) break
        }

        if (path) {
            store.dispatch(setLastVisitedScreen(lastVisitedScreen))
            SharedHelper.processUrlAsLoggedIn(NavigationService, path, true)
        }
    }
}

export default SharedHelper

export const ANONYMOUS_USER_DATA = {
    displayName: 'Anonymous User',
    email: 'anonymous@alldone.com',
    photoURL: 'https://mystaging.alldone.app/images/generic-user.svg',
    isAnonymous: true,
    themeName: COLORS_THEME_MODERN,
    sidebarExpanded: SIDEBAR_COLLAPSED,
    language: getDeviceLanguage(),
    timezone: parseInt(momentTz().format('Z')),
}
