import { findKey, includes, orderBy } from 'lodash'
import moment from 'moment'

import {
    PROJECT_TYPE_ACTIVE,
    PROJECT_TYPE_ARCHIVED,
    PROJECT_TYPE_TEMPLATE,
    PROJECT_TYPE_SHARED,
    PROJECT_TYPE_GUIDE,
} from './ProjectsSettings'
import store from '../../../redux/store'
import Backend from '../../../utils/BackendBridge'
import {
    navigateToAllProjectsTasks,
    navigateToSettings,
    setActiveGuideId,
    setActiveTemplateId,
    setAreArchivedActive,
    setBacklinkSection,
    setProjectInvitationData,
    setSelectedNavItem,
    showProjectInvitation,
} from '../../../redux/actions'
import URLsTasks, { URL_ALL_PROJECTS_TASKS_OPEN } from '../../../URLSystem/Tasks/URLsTasks'
import URLsProjects, {
    URL_PROJECT_DETAILS,
    URL_PROJECT_DETAILS_BACKLINKS_TASKS,
    URL_PROJECT_DETAILS_FEED,
    URL_PROJECT_DETAILS_MEMBERS,
    URL_PROJECT_DETAILS_PROPERTIES,
    URL_PROJECT_DETAILS_STATISTICS,
    URL_PROJECT_DETAILS_ASSISTANTS,
} from '../../../URLSystem/Projects/URLsProjects'
import {
    DV_TAB_PROJECT_PROPERTIES,
    DV_TAB_PROJECT_TEAM_MEMBERS,
    DV_TAB_PROJECT_UPDATES,
    DV_TAB_SETTINGS_PROJECTS,
    DV_TAB_PROJECT_STATISTICS,
    DV_TAB_PROJECT_ASSISTANTS,
} from '../../../utils/TabNavigationConstants'
import { FEED_PUBLIC_FOR_ALL } from '../../Feeds/Utils/FeedsConstants'
import { DEFAULT_WORKSTREAM_ID, WORKSTREAM_ID_PREFIX } from '../../Workstreams/WorkstreamHelper'
import URLTrigger from '../../../URLSystem/URLTrigger'
import NavigationService from '../../../utils/NavigationService'
import { ESTIMATION_TYPE_TIME } from '../../../utils/EstimationHelper'
import {
    PROJECT_COLOR_BLUE,
    PROJECT_COLOR_DEFAULT,
    PROJECT_COLOR_GREEN,
    PROJECT_COLOR_LIME,
    PROJECT_COLOR_ORANGE,
    PROJECT_COLOR_PELOROUS,
    PROJECT_COLOR_PINK,
    PROJECT_COLOR_PURPLE,
    PROJECT_COLOR_RED,
    PROJECT_COLOR_VIOLET,
    PROJECT_COLOR_YELLOW,
} from '../../../Themes/Modern/ProjectColors'
import { checkIfUrlBelongsToProjectInTheList } from '../../../utils/LinkingHelper'
import { getAssistant } from '../../AdminPanel/Assistants/assistantsHelper'
import {
    getContactData,
    setProjectContactCompany,
    setProjectContactDescription,
    setProjectContactRole,
} from '../../../utils/backends/Contacts/contactsFirestore'
import {
    setUserCompany,
    setUserCompanyInProject,
    setUserDescription,
    setUserDescriptionInProject,
    setUserPhone,
    setUserRole,
    setUserRoleInProject,
} from '../../../utils/backends/Users/usersFirestore'
import { generateSortIndex } from '../../../utils/backends/firestore'

export const PROJECT_COLORS = {
    [PROJECT_COLOR_DEFAULT]: 'Default',
    [PROJECT_COLOR_BLUE]: 'Color 1',
    [PROJECT_COLOR_VIOLET]: 'Color 2',
    [PROJECT_COLOR_ORANGE]: 'Color 3',
    [PROJECT_COLOR_PELOROUS]: 'Color 4',
    [PROJECT_COLOR_YELLOW]: 'Color 5',
    [PROJECT_COLOR_GREEN]: 'Color 6',
    [PROJECT_COLOR_PINK]: 'Color 7',
    [PROJECT_COLOR_RED]: 'Color 8',
    [PROJECT_COLOR_LIME]: 'Color 9',
    [PROJECT_COLOR_PURPLE]: 'Color 10',
}

export const MAX_USERS_IN_GUIDES = 50

export const TYPE_USER_MEMBER = 'Member'
export const TYPE_USER_CONTACT = 'Contact'

export const PROJECT_PUBLIC = 0
export const PROJECT_RESTRICTED = 1
export const PROJECT_PRIVATE = 2

export const ALL_PROJECTS_INDEX = -1

export const checkIfSelectedAllProjects = projectIndex => projectIndex === ALL_PROJECTS_INDEX
export const checkIfSelectedProject = projectIndex => projectIndex > ALL_PROJECTS_INDEX

class ProjectHelper {
    static getProjectsByType2 = (projects, type, user) => {
        switch (type) {
            case PROJECT_TYPE_ACTIVE:
                return this.getActiveProjects2(projects, user)
            case PROJECT_TYPE_TEMPLATE:
                return this.getTemplateProjects(projects, user)
            case PROJECT_TYPE_GUIDE:
                return this.getGuideProjects(projects, user)
            case PROJECT_TYPE_ARCHIVED:
                return this.getArchivedProjects2(projects, user)
        }
    }

    static getActiveProjects2 = (projects, user) => {
        return projects.filter(
            project =>
                user.projectIds.includes(project.id) &&
                !user.archivedProjectIds.includes(project.id) &&
                !user.templateProjectIds.includes(project.id) &&
                !user.guideProjectIds.includes(project.id)
        )
    }

    static getTemplateProjects = (projects, user) => {
        return projects.filter(project => user.templateProjectIds.includes(project.id))
    }

    static getGuideProjects = (projects, user) => {
        return projects.filter(project => user.guideProjectIds.includes(project.id))
    }

    static getArchivedProjects2 = (projects, user) => {
        return projects.filter(project => user.archivedProjectIds.includes(project.id))
    }

    static getProjectsByType = (projects, user, type) => {
        return projects.filter(project => {
            switch (type) {
                case PROJECT_TYPE_ACTIVE:
                    return (
                        includes(user.projectIds, project.id) &&
                        !includes(user.archivedProjectIds, project.id) &&
                        !includes(user.templateProjectIds, project.id) &&
                        !includes(user.guideProjectIds, project.id)
                    )
                case PROJECT_TYPE_ARCHIVED:
                    return includes(user.archivedProjectIds, project.id)
                case PROJECT_TYPE_TEMPLATE:
                    return includes(user.templateProjectIds, project.id)
                case PROJECT_TYPE_GUIDE:
                    return includes(user.guideProjectIds, project.id)
                case PROJECT_TYPE_SHARED:
                    return (
                        !includes(user.projectIds, project.id) &&
                        !includes(user.archivedProjectIds, project.id) &&
                        !includes(user.templateProjectIds, project.id) &&
                        !includes(user.guideProjectIds, project.id)
                    )
            }
        })
    }

    static getActiveProjectsInList = (
        projects,
        userProjectIds,
        archivedProjectIds,
        templateProjectIds,
        guideProjectIds
    ) => {
        return projects.filter(
            project =>
                userProjectIds.includes(project.id) &&
                !archivedProjectIds.includes(project.id) &&
                !templateProjectIds.includes(project.id) &&
                !guideProjectIds.includes(project.id)
        )
    }

    static getArchivedProjectsInList = (projects, archivedProjectIds) => {
        return projects.filter(project => archivedProjectIds.includes(project.id))
    }

    static getTemplateProjectsInList = (projects, templateProjectIds) => {
        return projects.filter(project => templateProjectIds.includes(project.id))
    }

    static getGuideProjectsInList = (projects, guideProjectIds) => {
        return projects.filter(project => guideProjectIds.includes(project.id))
    }

    static getSharedProjectsInList = (projects, userProjectIds) => {
        return projects.filter(project => !includes(userProjectIds, project.id))
    }

    static getAmountActiveProjects = user => {
        const { projectIds, guideProjectIds, templateProjectIds, archivedProjectIds } = user
        const amountActiveProjects =
            projectIds.length - guideProjectIds.length - templateProjectIds.length - archivedProjectIds.length
        return amountActiveProjects
    }

    static checkIfProjectIsLastActiveProjectOfUser = (projectId, user) => {
        const projectType = ProjectHelper.getTypeOfProject(user, projectId)
        return projectType === PROJECT_TYPE_ACTIVE && ProjectHelper.getAmountActiveProjects(user) === 1
    }

    static getTypeOfProject = (user, projectId) => {
        const { uid, archivedProjectIds, templateProjectIds, projectIds, guideProjectIds } = user
        if (
            uid.startsWith(WORKSTREAM_ID_PREFIX) ||
            (includes(projectIds, projectId) &&
                !includes(archivedProjectIds, projectId) &&
                !includes(templateProjectIds, projectId) &&
                !includes(guideProjectIds, projectId))
        ) {
            return PROJECT_TYPE_ACTIVE
        } else if (includes(archivedProjectIds, projectId)) {
            return PROJECT_TYPE_ARCHIVED
        } else if (includes(templateProjectIds, projectId)) {
            return PROJECT_TYPE_TEMPLATE
        } else if (includes(guideProjectIds, projectId)) {
            return PROJECT_TYPE_GUIDE
        } else if (
            !includes(projectIds, projectId) &&
            !includes(archivedProjectIds, projectId) &&
            !includes(templateProjectIds, projectId) &&
            !includes(guideProjectIds, projectId)
        ) {
            return PROJECT_TYPE_SHARED
        }
        return null
    }

    static getCurrentProject() {
        const { loggedUserProjects, selectedProjectIndex } = store.getState()
        return loggedUserProjects[selectedProjectIndex]
    }

    static getProjectIndexById(projectId) {
        const { loggedUserProjectsMap } = store.getState()
        return loggedUserProjectsMap[projectId].index
    }

    static getProjectById(projectId) {
        const { loggedUserProjectsMap } = store.getState()
        return loggedUserProjectsMap[projectId]
    }

    static checkIfProjectIsGuide(projectIndex) {
        if (checkIfSelectedProject(projectIndex)) {
            const project = ProjectHelper.getProjectByIndex(projectIndex)
            if (project) return !!project.parentTemplateId
        }
        return false
    }

    static getProjectByIndex(projectIndex) {
        const { loggedUserProjects } = store.getState()
        return loggedUserProjects[projectIndex]
    }

    static getProjectUserById(projectId, userId) {
        const { projectUsers } = store.getState()
        return projectUsers[projectId] ? projectUsers[projectId].find(user => user.uid === userId) : null
    }

    static getProjectContactById(projectId, contactId) {
        const { projectContacts } = store.getState()
        return projectContacts[projectId] ? projectContacts[projectId].find(contact => contact.uid === contactId) : null
    }

    static getProjectNameById(projectId, defaultName) {
        const project = ProjectHelper.getProjectById(projectId)
        return project ? project.name : defaultName ? defaultName : ''
    }

    static getProjectColorById(projectId, defaultName) {
        const project = ProjectHelper.getProjectById(projectId)
        return project ? project.color : defaultName ? defaultName : ''
    }

    static getUserNameById(projectId, userId, defaultName) {
        const user =
            ProjectHelper.getProjectUserById(projectId, userId) ||
            ProjectHelper.getProjectContactById(projectId, userId) ||
            getAssistant(userId)
        return user ? user.displayName : defaultName ? defaultName : ''
    }

    static getContactNameById(projectId, contactId, defaultName) {
        const contact = ProjectHelper.getProjectContactById(projectId, contactId)
        return contact ? contact.displayName : defaultName ? defaultName : ''
    }

    static showModalForJointToProject(navigation, data) {
        store.dispatch([
            showProjectInvitation(),
            setProjectInvitationData(data),
            navigateToSettings({ selectedNavItem: DV_TAB_SETTINGS_PROJECTS }),
        ])
        navigation.navigate('SettingsView')
    }

    static processProjectInvitation = async (navigation, uidOrEmail, projectId) => {
        const project = await Backend.getProjectData(projectId)
        const user = await Backend.getUserDataByUidOrEmail(uidOrEmail)
        if (project != null && user != null) {
            const data = { project: project, user: user }
            ProjectHelper.showModalForJointToProject(navigation, data)
            return user.uid
        }
        return null
    }

    static goToAllProjects = () => {
        NavigationService.navigate('Root')
        store.dispatch(navigateToAllProjectsTasks())
        URLsTasks.replace(URL_ALL_PROJECTS_TASKS_OPEN)
    }

    static getTypeOfUserInProject = (projectIndex, userId) => {
        const { loggedUserProjects } = store.getState()
        const project = loggedUserProjects[projectIndex]

        const uKeyMember = findKey(project.userIds, uId => uId === userId)
        const contact = getContactData(project.id, userId)

        if (uKeyMember !== undefined) {
            return TYPE_USER_MEMBER
        } else if (contact != null) {
            return TYPE_USER_CONTACT
        }

        return null
    }

    static getUserRoleInProject = (projectId, userId, defaultRole) => {
        const project = this.getProjectById(projectId)
        return project?.usersData[userId]?.role ? project?.usersData[userId]?.role : defaultRole ? defaultRole : ''
    }

    static getUserCompanyInProject = (projectId, userId, defaultCompany) => {
        const project = this.getProjectById(projectId)
        return project?.usersData[userId]?.company
            ? project?.usersData[userId]?.company
            : defaultCompany
            ? defaultCompany
            : ''
    }

    static getUserDescriptionInProject = (
        projectId,
        userId,
        defaultDescription,
        defaultExtendedDescription,
        extended
    ) => {
        const project = this.getProjectById(projectId)
        if (extended) {
            return project?.usersData[userId]?.extendedDescription
                ? project?.usersData[userId]?.extendedDescription
                : defaultExtendedDescription
                ? defaultExtendedDescription
                : ''
        } else {
            return project?.usersData[userId]?.description
                ? project?.usersData[userId]?.description
                : defaultDescription
                ? defaultDescription
                : ''
        }
    }

    static getUserHighlightInProject = (projectIndex, user) => {
        const { loggedUserProjects } = store.getState()
        const project = loggedUserProjects[projectIndex]

        if (project?.usersData[user.uid]?.hasStar != null && project?.usersData[user.uid]?.hasStar !== '') {
            return project.usersData[user.uid].hasStar
        } else if (user?.hasStar !== '') {
            return user.hasStar
        }

        return '#FFFFFF'
    }

    static getUserPrivacyInProject = (projectIndex, user) => {
        const { loggedUserProjects } = store.getState()
        const project = loggedUserProjects[projectIndex]
        const privacy = { isPrivate: false, isPublicFor: [FEED_PUBLIC_FOR_ALL, user.uid] }

        if (project?.usersData[user.uid]?.isPrivate != null) {
            privacy.isPrivate = project.usersData[user.uid].isPrivate
        }
        if (project?.usersData[user.uid]?.isPublicFor != null) {
            privacy.isPublicFor = project.usersData[user.uid].isPublicFor
        }

        return privacy
    }

    static getUserPrivacyInProjectById = async (projectId, user) => {
        let project = await Backend.getProjectBy(projectId)
        const privacy = { isPrivate: false, isPublicFor: [FEED_PUBLIC_FOR_ALL, user.uid] }

        if (project?.usersData[user.uid]?.isPrivate != null) {
            privacy.isPrivate = project.usersData[user.uid].isPrivate
        }
        if (project?.usersData[user.uid]?.isPublicFor != null) {
            privacy.isPublicFor = project.usersData[user.uid].isPublicFor
        }

        return privacy
    }

    static setUserInfoInProject = async (projectId, projectIndex, userId, company, role, extDescription) => {
        const { projectUsers, loggedUserProjectsMap } = store.getState()
        const project = loggedUserProjectsMap[projectId]
        const user = projectUsers[projectId].find(user => user.uid === userId)

        const oldCompany = this.getUserCompanyInProject(project.id, user.uid, user.company)
        const oldRole = this.getUserRoleInProject(project.id, user.uid, user.role)
        const oldExtDescription = this.getUserDescriptionInProject(
            project.id,
            user.uid,
            user.description,
            user.extendedDescription,
            true
        )

        if (company !== oldCompany) {
            await setUserCompanyInProject(project, user, company, oldCompany)
        }
        if (role !== oldRole) {
            await setUserRoleInProject(project, user, role, oldRole)
        }
        if (extDescription !== oldExtDescription) {
            await setUserDescriptionInProject(project, user, extDescription, oldExtDescription)
        }
    }

    static checkIfProjectIdBelongsToInactiveProject = projectId => {
        const { loggedUser, activeGuideId, activeTemplateId, areArchivedActive } = store.getState()
        const { realGuideProjectIds, realTemplateProjectIds, realArchivedProjectIds } = loggedUser

        if (activeGuideId !== projectId && realGuideProjectIds.includes(projectId))
            return { inactive: true, projectType: PROJECT_TYPE_GUIDE }
        if (activeTemplateId !== projectId && realTemplateProjectIds.includes(projectId))
            return { inactive: true, projectType: PROJECT_TYPE_TEMPLATE }
        if (!areArchivedActive && realArchivedProjectIds.includes(projectId))
            return { inactive: true, projectType: PROJECT_TYPE_ARCHIVED }

        return { inactive: false, projectType: '' }
    }

    static processInactiveProjectsWhenLoginUser = user => {
        const { archivedProjectIds, templateProjectIds, guideProjectIds } = user
        const { pathname } = window.location
        const userIsCreatorOrAdmin = user.templateProjectIds.length > 0

        if (userIsCreatorOrAdmin) {
            const urlGuideProjectId = checkIfUrlBelongsToProjectInTheList(pathname, guideProjectIds)
            if (urlGuideProjectId) {
                store.dispatch(setActiveGuideId(urlGuideProjectId))
                return
            }

            const urlTemplateProjectId = checkIfUrlBelongsToProjectInTheList(pathname, templateProjectIds)
            if (urlTemplateProjectId) {
                store.dispatch(setActiveTemplateId(urlTemplateProjectId))
                return
            }
        }

        const urlArchivedProjectId = checkIfUrlBelongsToProjectInTheList(pathname, archivedProjectIds)
        if (urlArchivedProjectId) {
            store.dispatch(setAreArchivedActive(true))
            return
        }
    }

    static navigateToInactiveProject = async (projectType, linkUrl) => {
        if (projectType === PROJECT_TYPE_GUIDE) {
            window.location.href = linkUrl
        } else if (projectType === PROJECT_TYPE_TEMPLATE) {
            window.location.href = linkUrl
        } else if (projectType === PROJECT_TYPE_ARCHIVED) {
            window.location.href = linkUrl
        }
    }

    static setUserInfoGlobally = async (userId, role, company, extDescription) => {
        const { loggedUserProjects } = store.getState()
        let promises = []

        for (let project of loggedUserProjects) {
            const userData = project.usersData[userId]
            if (userData != null) {
                const newRole = userData.role === role ? null : role
                const newCompany = userData.company === company ? null : company
                const newDescription = userData.description === extDescription ? null : extDescription
                promises.push(
                    ProjectHelper.setUserInfoInProject(
                        project.id,
                        project.index,
                        userId,
                        newCompany,
                        newRole,
                        newDescription
                    )
                )
            }
        }

        await setUserRole(userId, role)
        await setUserCompany(userId, company)
        await setUserDescription(userId, extDescription)
        Promise.all(promises)
    }

    static setContactInfoInProject = async (
        projectIndex,
        contact,
        contactId,
        company,
        oldCompany,
        role,
        oldRole,
        extDescription,
        oldDescription
    ) => {
        const { loggedUserProjects } = store.getState()
        const projectId = loggedUserProjects[projectIndex].id

        if (company !== oldCompany) {
            await setProjectContactCompany(projectId, contact, contactId, company, oldCompany)
        }
        if (role !== oldRole) {
            await setProjectContactRole(projectId, contact, contactId, role, oldRole)
        }
        if (extDescription !== oldDescription) {
            await setProjectContactDescription(projectId, contact, contactId, extDescription, oldDescription)
        }
    }

    static processURLProjectDetails = (navigation, projectId, tabConstant) => {
        const projectIndex = ProjectHelper.getProjectIndexById(projectId)
        const backlinkSection = {
            index: tabConstant === URL_PROJECT_DETAILS_BACKLINKS_TASKS ? 1 : 0,
            section: tabConstant === URL_PROJECT_DETAILS_BACKLINKS_TASKS ? 'Tasks' : 'Notes',
        }

        if (checkIfSelectedProject(projectIndex)) {
            const data = { projectIndex: projectIndex }
            URLsProjects.replace(tabConstant !== undefined ? tabConstant : URL_PROJECT_DETAILS, data, projectId)
            navigation.navigate('ProjectDetailedView', data)
            store.dispatch(setBacklinkSection(backlinkSection))
        } else {
            URLTrigger.directProcessUrl(NavigationService, '/projects/tasks/open')
        }
    }

    /**
     *
     * @param navigation
     * @param tab   ['Properties', 'Project members']
     * @param projectId
     * @param filterConstant
     * @returns {Promise<void>}
     */
    static processURLProjectDetailsTab = async (navigation, tab, projectId, filterConstant) => {
        store.dispatch(setSelectedNavItem(tab))
        let urlConstant

        switch (tab) {
            case DV_TAB_PROJECT_PROPERTIES:
                urlConstant = URL_PROJECT_DETAILS_PROPERTIES
                break
            case DV_TAB_PROJECT_TEAM_MEMBERS:
                urlConstant = URL_PROJECT_DETAILS_MEMBERS
                break
            case DV_TAB_PROJECT_UPDATES:
                urlConstant = URL_PROJECT_DETAILS_FEED
                break
            case DV_TAB_PROJECT_STATISTICS:
                urlConstant = URL_PROJECT_DETAILS_STATISTICS
                break
            case DV_TAB_PROJECT_ASSISTANTS:
                urlConstant = URL_PROJECT_DETAILS_ASSISTANTS
                break
        }
        await ProjectHelper.processURLProjectDetails(navigation, projectId, urlConstant)
    }

    static getNewDefaultProject = () => {
        const { loggedUser, defaultAssistant } = store.getState()

        const date = Date.now()
        const project = {
            color: PROJECT_COLOR_DEFAULT,
            created: date,
            creatorId: loggedUser.uid,
            name: '',
            description: '',
            projectStartDate: date,
            userIds: [loggedUser.uid],
            isPrivate: true,
            isShared: PROJECT_PUBLIC,
            estimationType: ESTIMATION_TYPE_TIME,
            lastActionDate: date,
            monthlyXp: 0,
            monthlyTraffic: 0,
            isTemplate: false,
            templateCreatorId: '',
            guideProjectIds: [],
            parentTemplateId: '',
            activeFullSearch: null,
            hourlyRatesData: { currency: 'EUR', hourlyRates: {} },
            lastChatActionDate: moment().subtract(30, 'year').valueOf(),
            usersData: {},
            workstreamIds: [DEFAULT_WORKSTREAM_ID],
            globalAssistantIds: [],
            lastLoggedUserDate: date,
            lastUserInteractionDate: date,
            active: true,
            assistantId: '',
            autoEstimation: true,
            sortIndexByUser: { [loggedUser.uid]: generateSortIndex() },
        }
        return project
    }

    static getProjectIsSharedTitle = isShared => {
        switch (true) {
            case isShared === PROJECT_PUBLIC:
                return 'With link'
            case isShared === PROJECT_RESTRICTED:
                return 'Restricted'
            case isShared === PROJECT_PRIVATE:
                return 'Private'
        }
    }

    static getProjectPrivacyIcon = isShared => {
        switch (true) {
            case isShared === PROJECT_PUBLIC:
                return 'edit-4'
            case isShared === PROJECT_RESTRICTED:
                return 'eye'
            case isShared === PROJECT_PRIVATE:
                return 'lock'
        }
    }

    static checkIfLoggedUserIsNormalUserInGuide = projectId => {
        const { loggedUser, administratorUser } = store.getState()
        const project = ProjectHelper.getProjectById(projectId)

        if (project && project.parentTemplateId) {
            return (
                loggedUser.uid !== administratorUser.uid &&
                !loggedUser.realTemplateProjectIds.includes(project.parentTemplateId)
            )
        }
        return false
    }

    static checkIfLoggedUserIsAdminUserInGuide = project => {
        const { loggedUser } = store.getState()

        if (project.parentTemplateId) {
            return loggedUser.realTemplateProjectIds.includes(project.parentTemplateId)
        }

        return false
    }

    static getNormalAndGuideProjects = (
        projectIds,
        guideProjectIds,
        archivedProjectIds,
        templateProjectIds,
        loggedUserProjectsMap
    ) => {
        const normalProjectIds = projectIds.filter(
            projectId =>
                loggedUserProjectsMap[projectId] &&
                !templateProjectIds.includes(projectId) &&
                !archivedProjectIds.includes(projectId) &&
                !guideProjectIds.includes(projectId)
        )

        return [...normalProjectIds, ...guideProjectIds]
    }

    static getNormalAndGuideProjectsSortedBySortedAndWithProjectInFocusAtTheTop = (
        projectIds,
        guideProjectIds,
        archivedProjectIds,
        templateProjectIds,
        loggedUserProjectsMap,
        userId,
        inFocusTaskProjectId
    ) => {
        const normalProjectIds = projectIds.filter(
            projectId =>
                inFocusTaskProjectId !== projectId &&
                loggedUserProjectsMap[projectId] &&
                !templateProjectIds.includes(projectId) &&
                !archivedProjectIds.includes(projectId) &&
                !guideProjectIds.includes(projectId)
        )

        const sortedNormalAndGuideProjects = [
            ...ProjectHelper.sortProjects(
                normalProjectIds.map(projectId => loggedUserProjectsMap[projectId]),
                userId
            ),
            ...ProjectHelper.sortProjects(
                guideProjectIds
                    .filter(projectId => loggedUserProjectsMap[projectId])
                    .map(projectId => loggedUserProjectsMap[projectId]),
                userId
            ),
        ]

        const sortedNormalAndGuideProjectIds = inFocusTaskProjectId
            ? [inFocusTaskProjectId, ...sortedNormalAndGuideProjects.map(p => p.id)]
            : sortedNormalAndGuideProjects.map(p => p.id)

        return sortedNormalAndGuideProjectIds
    }

    static sortProjects = (projects, userId) => {
        return orderBy(
            projects,
            [project => project.sortIndexByUser[userId], project => project.name.toLowerCase()],
            ['desc', 'asc']
        )
    }
}

export default ProjectHelper
