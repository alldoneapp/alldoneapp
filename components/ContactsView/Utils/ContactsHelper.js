import { findIndex } from 'lodash'
import momentTz from 'moment-timezone'
import moment from 'moment'

import SearchHelper from '../../../utils/SearchHelper'
import store from '../../../redux/store'
import URLsTasks, { URL_ALL_PROJECTS_TASKS_OPEN, URL_PROJECT_USER_TASKS_OPEN } from '../../../URLSystem/Tasks/URLsTasks'
import ProjectHelper, {
    ALL_PROJECTS_INDEX,
    checkIfSelectedAllProjects,
    checkIfSelectedProject,
} from '../../SettingsView/ProjectsSettings/ProjectHelper'
import {
    setBacklinkSection,
    setShowProjectDontExistInInvitationModal,
    setSelectedNavItem,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    storeCurrentUser,
    switchProject,
    updateContactsActiveTab,
    setUsersInProject,
    setContactsInProject,
    navigateToAllProjectsTasks,
    navigateToAllProjectsContacts,
} from '../../../redux/actions'
import URLsPeople, {
    URL_ALL_PROJECTS_PEOPLE_ALL,
    URL_ALL_PROJECTS_PEOPLE_FOLLOWED,
    URL_PEOPLE_DETAILS,
    URL_PEOPLE_DETAILS_BACKLINKS_TASKS,
    URL_PEOPLE_DETAILS_CHAT,
    URL_PEOPLE_DETAILS_FEED,
    URL_PEOPLE_DETAILS_NOTE,
    URL_PEOPLE_DETAILS_PROFILE,
    URL_PEOPLE_DETAILS_PROPERTIES,
    URL_PEOPLE_DETAILS_STATISTICS,
    URL_PEOPLE_DETAILS_WORKFLOW,
    URL_PROJECT_PEOPLE_ALL,
    URL_PROJECT_PEOPLE_FOLLOWED,
} from '../../../URLSystem/People/URLsPeople'
import Backend from '../../../utils/BackendBridge'
import URLsContacts, {
    URL_CONTACT_DETAILS,
    URL_CONTACT_DETAILS_BACKLINKS_TASKS,
    URL_CONTACT_DETAILS_CHAT,
    URL_CONTACT_DETAILS_FEED,
    URL_CONTACT_DETAILS_PROPERTIES,
} from '../../../URLSystem/Contacts/URLsContacts'
import TasksHelper from '../../TaskListView/Utils/TasksHelper'
import { ALL_TAB, FEED_PUBLIC_FOR_ALL, FOLLOWED_TAB } from '../../Feeds/Utils/FeedsConstants'
import {
    DV_TAB_CONTACT_BACKLINKS,
    DV_TAB_CONTACT_CHAT,
    DV_TAB_CONTACT_PROPERTIES,
    DV_TAB_CONTACT_UPDATES,
    DV_TAB_ROOT_CONTACTS,
    DV_TAB_USER_BACKLINKS,
    DV_TAB_USER_CHAT,
    DV_TAB_USER_NOTE,
    DV_TAB_USER_PROFILE,
    DV_TAB_USER_PROPERTIES,
    DV_TAB_USER_STATISTICS,
    DV_TAB_USER_UPDATES,
    DV_TAB_USER_WORKFLOW,
} from '../../../utils/TabNavigationConstants'
import SharedHelper from '../../../utils/SharedHelper'
import { PROJECT_TYPE_SHARED } from '../../SettingsView/ProjectsSettings/ProjectsSettings'
import { exitsOpenModals } from '../../ModalsManager/modalsManager'
import { getWorkstreamInProject, isWorkstream } from '../../Workstreams/WorkstreamHelper'
import { COLORS_THEME_MODERN } from '../../../Themes/Themes'
import { SIDEBAR_COLLAPSED } from '../../SidebarMenu/Collapsible/CollapsibleHelper'
import { PLAN_STATUS_FREE } from '../../Premium/PremiumHelper'
import NavigationService from '../../../utils/NavigationService'
import { getDeviceLanguage, translate } from '../../../i18n/TranslationService'
import HelperFunctions from '../../../utils/HelperFunctions'
import { getAssistant, getAssistantInProject } from '../../AdminPanel/Assistants/assistantsHelper'
import { getContactData, setContactLastVisitedBoardDate } from '../../../utils/backends/Contacts/contactsFirestore'
import { updateUserLastVisitedBoardDate } from '../../../utils/backends/Users/usersFirestore'

export const PHOTO_SIZE_50 = '50'
export const PHOTO_SIZE_300 = '300'
export const DAILY_GOLD_LIMIT = 150

class ContactsHelper {
    static matchContactSearch = (contact, searchText, projectIndex) => {
        const { loggedUserProjects } = store.getState()

        const matchUser = () => {
            const userData = loggedUserProjects[projectIndex]?.usersData?.[contact.uid]

            return (
                userData &&
                (SearchHelper.matchSearch(userData.company || '', searchText) ||
                    SearchHelper.matchSearch(userData.role || '', searchText) ||
                    SearchHelper.matchSearch(userData.description || '', searchText))
            )
        }

        const matchContact = () => {
            return (
                SearchHelper.matchSearch(contact.company, searchText) ||
                SearchHelper.matchSearch(contact.role, searchText) ||
                SearchHelper.matchSearch(contact.description, searchText)
            )
        }

        return (
            SearchHelper.matchSearch(contact.displayName, searchText) ||
            (!contact.recorderUserId && matchUser()) ||
            matchContact()
        )
    }

    static processURLAllProjectsPeople = (navigation, tab = FOLLOWED_TAB) => {
        const { selectedSidebarTab } = store.getState()
        if (!selectedSidebarTab) navigation.navigate('Root')
        store.dispatch(navigateToAllProjectsContacts({ contactsActiveTab: tab }))
        URLsPeople.replace(tab === ALL_TAB ? URL_ALL_PROJECTS_PEOPLE_ALL : URL_ALL_PROJECTS_PEOPLE_FOLLOWED)
    }

    static processURLProjectPeople = (navigation, projectId, userId, tab = FOLLOWED_TAB) => {
        const user = TasksHelper.getUserInProject(projectId, userId) || getWorkstreamInProject(projectId, userId)
        const currentUser = user !== null ? user : store.getState().loggedUser
        const projectIndex = ProjectHelper.getProjectIndexById(projectId)
        if (!store.getState().selectedSidebarTab) {
            navigation.navigate('Root')
        }
        store.dispatch([
            switchProject(projectIndex),
            storeCurrentUser(currentUser),
            setSelectedSidebarTab(DV_TAB_ROOT_CONTACTS),
            updateContactsActiveTab(tab),
        ])

        if (checkIfSelectedAllProjects(projectIndex)) {
            URLsPeople.replace(tab === ALL_TAB ? URL_ALL_PROJECTS_PEOPLE_ALL : URL_ALL_PROJECTS_PEOPLE_FOLLOWED)
        } else {
            const data = { projectId: projectId, userId: currentUser.uid }
            URLsPeople.replace(
                tab === ALL_TAB ? URL_PROJECT_PEOPLE_ALL : URL_PROJECT_PEOPLE_FOLLOWED,
                data,
                projectId,
                currentUser.uid
            )
        }
        // navigation.navigate('Root')
    }

    static navigateToUserProfile = (projectId, userId) => {
        const project = ProjectHelper.getProjectById(projectId)
        if (project && project.userIds.includes(userId)) {
            const user = TasksHelper.getUserInProject(projectId, userId)
            store.dispatch(setSelectedNavItem(DV_TAB_USER_PROFILE))
            NavigationService.navigate('UserDetailedView', {
                contact: user,
                project,
            })
        }
    }

    static processURLPeopleDetails = async (navigation, projectId, userId, tabConstant, tab) => {
        const { loggedUser, selectedSidebarTab } = store.getState()
        const project = ProjectHelper.getProjectById(projectId)
        const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)
        const projectIndex = project ? project.index : ALL_PROJECTS_INDEX
        tab = !accessGranted && tab === DV_TAB_USER_BACKLINKS ? DV_TAB_USER_PROFILE : tab
        const user = await Backend.getUserDataByUidOrEmail(userId)
        const backlinkSection = {
            index: tabConstant === URL_PEOPLE_DETAILS_BACKLINKS_TASKS || URL_CONTACT_DETAILS_BACKLINKS_TASKS ? 1 : 0,
            section:
                tabConstant === URL_PEOPLE_DETAILS_BACKLINKS_TASKS || URL_CONTACT_DETAILS_BACKLINKS_TASKS
                    ? 'Tasks'
                    : 'Notes',
        }

        if (user === null) {
            const contact = await getContactData(projectId, userId)
            if (contact != null) {
                tab = tab.replace('USER_', 'CONTACT_')
                tabConstant = tabConstant.replace('PEOPLE_', 'CONTACT_')
                return ContactsHelper.processURLContactDetailsTab(navigation, tab, projectId, userId, tabConstant)
            }
        }

        const inSelectedProject = checkIfSelectedProject(projectIndex)
        if (inSelectedProject && user != null) {
            const data = { projectId, userId }
            URLsPeople.push(tabConstant !== undefined ? tabConstant : URL_PEOPLE_DETAILS, data, projectId, userId)
            const navData = { contact: user, project }
            navigation.navigate('UserDetailedView', navData)

            store.dispatch([
                switchProject(projectIndex),
                storeCurrentUser(loggedUser),
                setBacklinkSection(backlinkSection),
                setSelectedNavItem(tab),
            ])
        } else if (inSelectedProject) {
            store.dispatch([
                switchProject(projectIndex),
                storeCurrentUser(loggedUser),
                setSelectedSidebarTab(DV_TAB_ROOT_CONTACTS),
            ])
            const data = { projectId: projectId }
            URLsPeople.replace(URL_PROJECT_PEOPLE_FOLLOWED, data, projectId)
            if (!selectedSidebarTab) {
                navigation.navigate('Root')
            }
        } else {
            if (!selectedSidebarTab) navigation.navigate('Root')
            store.dispatch(navigateToAllProjectsContacts())
            URLsPeople.replace(URL_ALL_PROJECTS_PEOPLE_FOLLOWED)
        }
    }

    /**
     *
     * @param navigation
     * @param tab   ['Properties', 'Updates', 'Workflow', 'Statistics']
     * @param projectId
     * @param userId
     * @param filterConstant
     * @returns {Promise<void>}
     */
    static processURLPeopleDetailsTab = async (navigation, tab, projectId, userId, filterConstant) => {
        if (!store.getState().selectedNavItem.startsWith('CONTACT_')) {
            store.dispatch(setSelectedNavItem(tab))
        }
        let urlConstant

        switch (tab) {
            case DV_TAB_USER_PROPERTIES:
                urlConstant = URL_PEOPLE_DETAILS_PROPERTIES
                break
            case DV_TAB_USER_PROFILE:
                urlConstant = URL_PEOPLE_DETAILS_PROFILE
                break
            case DV_TAB_USER_CHAT:
                urlConstant = URL_PEOPLE_DETAILS_CHAT
                break
            case DV_TAB_USER_NOTE:
                urlConstant = URL_PEOPLE_DETAILS_NOTE
                break
            case DV_TAB_USER_UPDATES:
                urlConstant = URL_PEOPLE_DETAILS_FEED
                break
            case DV_TAB_USER_WORKFLOW:
                urlConstant = URL_PEOPLE_DETAILS_WORKFLOW
                break
            case DV_TAB_USER_STATISTICS:
                urlConstant = URL_PEOPLE_DETAILS_STATISTICS
                break
            case DV_TAB_USER_BACKLINKS:
                urlConstant = filterConstant
                break
        }
        await ContactsHelper.processURLPeopleDetails(navigation, projectId, userId, urlConstant, tab)
    }

    static processURLProjectPeopleAdd = async (navigation, projectId, userId) => {
        const { loggedUserProjects, loggedUser, selectedSidebarTab } = store.getState()

        // Am I member of this project?
        const projectIndex = findIndex(loggedUserProjects, ['id', projectId])

        const processInvitation = (replaceFn, showPopup = false) => {
            const { index: toggleIndex, name: toggleName } = TasksHelper.getToggleSectionByURLConstant(
                URL_ALL_PROJECTS_TASKS_OPEN,
                true
            )
            const dispatches = [
                navigateToAllProjectsTasks({ taskViewToggleSection: toggleName, taskViewToggleIndex: toggleIndex }),
            ]
            showPopup && dispatches.push(setShowProjectDontExistInInvitationModal(true))
            store.dispatch(dispatches)

            replaceFn?.() // Replace URL in browser
            if (!selectedSidebarTab) {
                navigation.navigate('Root')
            }
        }

        const inSelectedProject = checkIfSelectedProject(projectIndex)
        // Checking userId with the UID and Email of Logged User
        if (inSelectedProject && (loggedUser.uid === userId || loggedUser.email === userId)) {
            // If I'm member        AND     I'm the invited user
            processInvitation(() => {
                URLsTasks.replace(URL_PROJECT_USER_TASKS_OPEN, null, projectId, loggedUser.uid)
            })
        } else if (inSelectedProject && loggedUser.uid !== userId && loggedUser.email !== userId) {
            // If I'm member        AND     I'm NOT the invited user
            processInvitation(() => {
                URLsTasks.replace(URL_PROJECT_USER_TASKS_OPEN, null, projectId, loggedUser.uid)
            })
        } else if (
            checkIfSelectedAllProjects(projectIndex) &&
            loggedUser.uid !== userId &&
            loggedUser.email !== userId
        ) {
            // If I'm NOT member    AND     I'm NOT the invited user
            processInvitation(() => {
                URLsTasks.replace(URL_ALL_PROJECTS_TASKS_OPEN)
            })
        } else {
            // If I'm NOT member    AND     I'm the invited user
            ProjectHelper.processProjectInvitation(navigation, loggedUser.uid, projectId).then(user => {
                if (user == null) {
                    processInvitation(() => {
                        URLsTasks.replace(URL_ALL_PROJECTS_TASKS_OPEN)
                    }, true)
                }
            })
        }
    }

    static processURLContactDetails = async (navigation, projectId, userId, tabConstant, tab) => {
        const { loggedUser, selectedSidebarTab } = store.getState()
        const project = ProjectHelper.getProjectById(projectId)
        const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)
        const projectIndex = project ? project.index : ALL_PROJECTS_INDEX
        tab = !accessGranted && tab === DV_TAB_CONTACT_BACKLINKS ? DV_TAB_CONTACT_PROPERTIES : tab
        const user = await getContactData(projectId, userId)
        const backlinkSection = {
            index: tabConstant === URL_CONTACT_DETAILS_BACKLINKS_TASKS || URL_PEOPLE_DETAILS_BACKLINKS_TASKS ? 1 : 0,
            section:
                tabConstant === URL_CONTACT_DETAILS_BACKLINKS_TASKS || URL_PEOPLE_DETAILS_BACKLINKS_TASKS
                    ? 'Tasks'
                    : 'Notes',
        }

        if (user === null) {
            const people = await Backend.getUserDataByUidOrEmail(userId)
            if (people != null) {
                tab = tab.replace('CONTACT_', 'USER_')
                return ContactsHelper.processURLPeopleDetailsTab(navigation, tab, projectId, userId)
            }
        }

        const inSelectedProject = checkIfSelectedProject(projectIndex)
        if (inSelectedProject && user != null) {
            const projectType = ProjectHelper.getTypeOfProject(loggedUser, projectId)
            const selectedUser =
                projectType === PROJECT_TYPE_SHARED
                    ? await Backend.getUserDataByUidOrEmail(user.recorderUserId)
                    : loggedUser
            const data = { projectId: projectId, userId: userId }
            URLsContacts.push(tabConstant !== undefined ? tabConstant : URL_CONTACT_DETAILS, data, projectId, userId)
            const navData = { contact: user, project }
            navigation.navigate('ContactDetailedView', navData)
            store.dispatch([
                switchProject(projectIndex),
                storeCurrentUser(selectedUser),
                setBacklinkSection(backlinkSection),
                setSelectedTypeOfProject(projectType),
                setSelectedNavItem(tab),
            ])
        } else if (inSelectedProject) {
            store.dispatch([
                switchProject(projectIndex),
                storeCurrentUser(loggedUser),
                setSelectedSidebarTab(DV_TAB_ROOT_CONTACTS),
            ])
            const data = { projectId: projectId }
            URLsPeople.replace(URL_PROJECT_PEOPLE_FOLLOWED, data, projectId)
            if (!selectedSidebarTab) {
                navigation.navigate('Root')
            }
        } else {
            if (!selectedSidebarTab) navigation.navigate('Root')
            store.dispatch(navigateToAllProjectsContacts())
            URLsPeople.replace(URL_ALL_PROJECTS_PEOPLE_FOLLOWED)
        }
    }

    /**
     *
     * @param navigation
     * @param tab   ['Properties']
     * @param projectId
     * @param userId
     * @param filterConstant
     * @returns {Promise<void>}
     */
    static processURLContactDetailsTab = async (navigation, tab, projectId, userId, filterConstant) => {
        if (!store.getState().selectedNavItem.startsWith('USER_')) {
            store.dispatch(setSelectedNavItem(tab))
        }
        let urlConstant

        switch (tab) {
            case DV_TAB_CONTACT_PROPERTIES:
                urlConstant = URL_CONTACT_DETAILS_PROPERTIES
                break
            case DV_TAB_CONTACT_CHAT:
                urlConstant = URL_CONTACT_DETAILS_CHAT
                break
            case DV_TAB_CONTACT_UPDATES:
                urlConstant = URL_CONTACT_DETAILS_FEED
                break
            case DV_TAB_CONTACT_BACKLINKS:
                urlConstant = filterConstant
                break
        }
        await ContactsHelper.processURLContactDetails(navigation, projectId, userId, urlConstant, tab)
    }

    static getContactPhotoURL(contact, isMember, size) {
        const getAvailablePhoto = () => {
            if (contact.photoURL50 !== '') {
                return contact.photoURL50
            } else if (contact.photoURL300 !== '') {
                return contact.photoURL300
            } else {
                return contact.photoURL
            }
        }

        if (isMember) {
            return contact.photoURL
        } else {
            if (size === PHOTO_SIZE_300 && contact.photoURL300 !== '') {
                return contact.photoURL300
            } else {
                return getAvailablePhoto()
            }
        }
    }

    static findUserInProject = (projectId, userId) => {
        const { projectUsers } = store.getState()
        return projectUsers[projectId]?.find(user => user.uid === userId)
    }

    static isPrivateContact = (contact, customUser, onlyCheckPrivacy = false) => {
        const { loggedUser } = store.getState()
        const user = customUser || loggedUser
        const userId = customUser?.uid || loggedUser.uid
        return (
            contact != null &&
            contact.isPrivate &&
            (onlyCheckPrivacy ||
                user.isAnonymous ||
                (contact.recorderUserId !== userId && (!contact.isPublicFor || !contact.isPublicFor.includes(userId))))
        )
    }

    static isPrivateUser = (projectIndex, contact, customUser, onlyCheckPrivacy = false) => {
        const { loggedUser } = store.getState()
        const { isPrivate, isPublicFor } = ProjectHelper.getUserPrivacyInProject(projectIndex, contact)
        const user = customUser || loggedUser
        const userId = customUser?.uid || loggedUser.uid
        return (
            isPrivate &&
            (onlyCheckPrivacy ||
                user.isAnonymous ||
                (contact.uid !== userId && (!isPublicFor || !isPublicFor.includes(userId))))
        )
    }

    static isPrivateUserById = async (projectId, contact, customUser, onlyCheckPrivacy = false) => {
        const { loggedUser } = store.getState()
        const { isPrivate, isPublicFor } = await ProjectHelper.getUserPrivacyInProjectById(projectId, contact)
        const user = customUser || loggedUser
        const userId = customUser?.uid || loggedUser.uid
        return (
            isPrivate &&
            (onlyCheckPrivacy ||
                user.isAnonymous ||
                (contact.uid !== userId && (!isPublicFor || !isPublicFor.includes(userId))))
        )
    }

    static getDefaultContactInfo = () => {
        const { loggedUser } = store.getState()

        return {
            displayName: '',
            photoURL: '',
            photoURL50: '',
            photoURL300: '',
            company: '',
            role: '',
            description: '',
            extendedDescription: '',
            hasStar: '#FFFFFF',
            isPrivate: false,
            isPublicFor: [FEED_PUBLIC_FOR_ALL, loggedUser.uid],
            recorderUserId: loggedUser.uid,
            email: '',
            phone: '',
            lastEditorId: loggedUser.uid,
            lastEditionDate: moment().valueOf(),
            noteId: null,
            isPremium: false,
            lastVisitBoard: {},
            lastVisitBoardInGoals: {},
            assistantId: '',
            commentsData: null,
            openTasksAmount: 0,
        }
    }

    static getAndAssignUserPrivacy = (projectIndex, user) => {
        const { isPrivate, isPublicFor } = ProjectHelper.getUserPrivacyInProject(projectIndex, user)
        user.isPrivate = isPrivate
        user.isPublicFor = isPublicFor
    }

    static sortContactsFn = (a, b, projectId) => {
        if ((a.lastEditionDate || 0) > (b.lastEditionDate || 0)) {
            return -1
        } else if ((a.lastEditionDate || 0) < (b.lastEditionDate || 0)) {
            return 1
        } else if (a.displayName < b.displayName) {
            return -1
        } else if (b.displayName > a.displayName) {
            return 1
        } else {
            return 0
        }
    }

    static setUserLastVisitedBoardDate = (projectId, user, lastVisitBoardProperty) => {
        const { projectUsers, loggedUser } = store.getState()
        const updatedUser = {
            ...user,
            [lastVisitBoardProperty]: {
                ...user?.[lastVisitBoardProperty],
                [projectId]: {
                    ...user?.[lastVisitBoardProperty]?.[projectId],
                    [loggedUser.uid]: Date.now(),
                },
            },
        }

        const usersInProject = [...projectUsers[projectId]]
        const index = usersInProject.findIndex(item => item.uid === user.uid)
        usersInProject[index] = updatedUser
        store.dispatch(setUsersInProject(projectId, usersInProject))

        updateUserLastVisitedBoardDate(projectId, user.uid, lastVisitBoardProperty)
    }

    static updateContactLastVisitedBoardDate = (projectId, contact, lastVisitBoardProperty) => {
        const { projectContacts, loggedUser } = store.getState()

        const updatedContact = {
            ...contact,
            [lastVisitBoardProperty]: {
                ...contact?.[lastVisitBoardProperty],
                [projectId]: {
                    ...contact?.[lastVisitBoardProperty]?.[projectId],
                    [loggedUser.uid]: Date.now(),
                },
            },
        }

        const contactsInProject = [...projectContacts[projectId]]
        const index = contactsInProject.findIndex(item => item.uid === contact.uid)
        contactsInProject[index] = updatedContact
        store.dispatch(setContactsInProject(projectId, contactsInProject))

        setContactLastVisitedBoardDate(projectId, contact.uid, lastVisitBoardProperty)
    }
}

export const isSomeContactEditOpen = () => {
    const edits = document.querySelectorAll('[data-edit-contact]')
    return edits.length > 0 || exitsOpenModals()
}

export const getIfLoggedUserReachedEmptyInbox = dateTimestamp => {
    const { lastDayEmptyInbox } = store.getState().loggedUser
    const lastDateMoment = moment(lastDayEmptyInbox)
    const date = moment(dateTimestamp)
    return !lastDateMoment.isBefore(date, 'day')
}

export const getUserWorkflow = (projectId, userId) => {
    const user = TasksHelper.getUserInProject(projectId, userId)
    const workflow = user && user.workflow && user.workflow[projectId] ? user.workflow[projectId] : null
    return workflow
}

export const filterContactsByPrivacy = (contacts, loggedUser) => {
    return contacts.filter(contact => !ContactsHelper.isPrivateContact(contact, loggedUser))
}

export const isUser = contactOrUser => {
    const { recorderUserId } = contactOrUser
    return recorderUserId === null || recorderUserId === undefined
}

export const isContact = contactOrUser => {
    const { recorderUserId } = contactOrUser
    return recorderUserId !== null && recorderUserId !== undefined
}

export const getUnknownUserData = () => {
    return {
        photoURL: `${window.location.origin}/icons/Generic-User32px.png`,
        displayName: translate('Unknown user'),
        shortName: translate('Unknown user'),
        isUnknownUser: true,
    }
}

export const getUserPresentationData = userId => {
    if (userId) {
        const user = TasksHelper.getUser(userId)
        if (user) {
            return {
                photoURL: user.photoURL,
                displayName: user.displayName,
                shortName: HelperFunctions.getFirstName(user.displayName),
                isProjectUser: true,
            }
        }
        const assistant = getAssistant(userId)
        if (assistant) {
            return {
                photoURL: assistant.photoURL50 || getUnknownUserData().photoURL,
                displayName: assistant.displayName,
                shortName: HelperFunctions.getFirstName(assistant.displayName),
                isAssistant: true,
            }
        }
    }
    return getUnknownUserData()
}

export const getUserPresentationDataInProject = (projectId, userId) => {
    if (userId) {
        if (isWorkstream(userId)) {
            const workstream = getWorkstreamInProject(projectId, userId)
            if (workstream)
                return {
                    photoURL: '',
                    displayName: workstream.displayName,
                    shortName: workstream.displayName,
                }
        } else {
            const user = TasksHelper.getUserInProject(projectId, userId)
            if (user)
                return {
                    photoURL: user.photoURL,
                    displayName: user.displayName,
                    shortName: HelperFunctions.getFirstName(user.displayName),
                    isProjectUser: true,
                }
            else {
                const contact = TasksHelper.getContactInProject(projectId, userId)
                if (contact)
                    return {
                        photoURL: contact.photoURL50,
                        displayName: contact.displayName,
                        shortName: HelperFunctions.getFirstName(contact.displayName),
                    }
                else {
                    const assistant = getAssistantInProject(projectId, userId)
                    if (assistant)
                        return {
                            photoURL: assistant.photoURL50 || getUnknownUserData().photoURL,
                            displayName: assistant.displayName,
                            shortName: HelperFunctions.getFirstName(assistant.displayName),
                            isAssistant: true,
                        }
                }
            }
        }
    }
    return getUnknownUserData()
}

export const getNewDefaultUser = (customData = {}) => {
    const dateNow = Date.now()
    return {
        displayName: '',
        email: '',
        notificationEmail: '',
        lastLogin: dateNow,
        photoURL: '',
        projectIds: [],
        receiveEmails: true,
        archivedProjectIds: [],
        templateProjectIds: [],
        guideProjectIds: [],
        invitedProjectIds: [],
        copyProjectIds: [],
        workflow: null,
        company: '',
        role: '',
        description: '',
        extendedDescription: '',
        hasStar: '#FFFFFF',
        fcmToken: [],
        xp: 0,
        level: 1,
        karma: 0,
        timezone: parseInt(momentTz().format('Z')),
        numberTodayTasks: 10,
        botAdvaiceTriggerPercent: 10,
        numberGoalsAllTeams: 5,
        numberChatsAllTeams: 5,
        numberUsersSidebar: 3,
        defaultCameraId: 'default',
        defaultAudioInputId: 'default',
        lastEditorId: customData.uid,
        lastEditionDate: dateNow,
        lastVisitBoard: {},
        lastVisitBoardInGoals: {},
        dateFormat: null,
        language: getDeviceLanguage(),
        mondayFirstInCalendar: null,
        customerId: '',
        premium: { status: PLAN_STATUS_FREE },
        isPrivate: false,
        isPublicFor: customData.uid ? [FEED_PUBLIC_FOR_ALL, customData.uid] : [FEED_PUBLIC_FOR_ALL],
        pushNotificationsStatus: false,
        workstreams: {},
        themeName: COLORS_THEME_MODERN,
        sidebarExpanded: SIDEBAR_COLLAPSED,
        gold: 100,
        dailyGold: DAILY_GOLD_LIMIT,
        statisticsData: { filter: 'Current month', customDateRange: [] },
        statisticsModalDate: dateNow,
        previousStatisticsModalDate: dateNow,
        defaultCurrency: 'EUR',
        dailyTopicDate: dateNow,
        previousDailyTopicDate: dateNow,
        lastDayEmptyInbox: dateNow,
        quotaWarnings: {},
        monthlyXp: 0,
        monthlyTraffic: 0,
        skillPoints: 0,
        showSkillPointsNotification: true,
        newEarnedSkillPoints: 0,
        statisticsSelectedUsersIds: {},
        singUpUrl: '',
        noticeAboutTheBotBehavior: false,
        defaultProjectId: '',
        apisConnected: null,
        noteIdsByProject: {},
        unlockedKeysByGuides: {},
        inFocusTaskId: '',
        inFocusTaskProjectId: '',
        assistantId: '',
        activeFullSearchDate: null,
        commentsData: {},
        firstLoginDateInDay: dateNow,
        activeTaskStartingDate: dateNow,
        activeTaskInitialEndingDate: dateNow,
        activeTaskId: '',
        activeTaskProjectId: '',
        showAllProjectsByTime: false,
        lastAssistantCommentData: {},
        ...customData,
    }
}

export default ContactsHelper
