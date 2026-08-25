import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { orderBy, sortBy } from 'lodash'
import { useSelector, useDispatch } from 'react-redux'

import ContactsHeader from './ContactsHeader'
import ContactListByProject from './ContactListByProject'
import { ALL_PROJECTS_INDEX, checkIfSelectedAllProjects } from '../SettingsView/ProjectsSettings/ProjectHelper'
import URLsPeople, {
    URL_ALL_PROJECTS_PEOPLE_ALL,
    URL_ALL_PROJECTS_PEOPLE_FOLLOWED,
    URL_PROJECT_PEOPLE_ALL,
    URL_PROJECT_PEOPLE_FOLLOWED,
} from '../../URLSystem/People/URLsPeople'
import { setNavigationRoute, startLoadingData, stopLoadingData } from '../../redux/actions'
import { ALL_TAB, FOLLOWED_TAB } from '../Feeds/Utils/FeedsConstants'
import { DV_TAB_ROOT_CONTACTS } from '../../utils/TabNavigationConstants'
import NothingToShow from '../UIComponents/NothingToShow'
import HashtagFiltersView from '../HashtagFilters/HashtagFiltersView'
import ContactStatusFiltersView from '../ContactStatusFilters/ContactStatusFiltersView'
import AllProjectsLine from '../TaskListView/Header/AllProjectsLine/AllProjectsLine'
import { watchFollowedPeople } from '../../utils/backends/Contacts/followedPeopleFirestore'
import { createFollowedPeopleBatcher } from './followedPeopleBatcher'
import { buildContactsViewData } from './contactsViewData'
import { getProjectsForContactsView } from './contactsViewProjectScope'
import { ensureProjectDataLoaded, PROJECT_DATA_CONTACTS } from '../../utils/InitialLoad/projectDataLoader'
import useRateLimitedProjectReveal from '../../hooks/useRateLimitedProjectReveal'

export function ContactsProjectLoader({ projectId, trackInitialLoad, onInitialSnapshot }) {
    const dispatch = useDispatch()

    useEffect(() => {
        let active = true
        let loadingActive = trackInitialLoad
        if (trackInitialLoad) dispatch(startLoadingData())
        const finishLoading = () => {
            if (!loadingActive) return
            loadingActive = false
            dispatch(stopLoadingData())
        }

        ensureProjectDataLoaded(projectId, PROJECT_DATA_CONTACTS, {
            trackConnectionHealth: trackInitialLoad,
        })
            .catch(() => false)
            .then(() => {
                if (!active) return
                finishLoading()
                onInitialSnapshot(projectId)
            })

        return () => {
            active = false
            finishLoading()
        }
    }, [projectId, trackInitialLoad])

    return null
}

export default function ContactsView() {
    const dispatch = useDispatch()
    const loggedUser = useSelector(state => state.loggedUser)
    const contactsActiveTab = useSelector(state => state.contactsActiveTab)
    const selectedTypeOfProject = useSelector(state => state.selectedTypeOfProject)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const projectUsers = useSelector(state => state.projectUsers)
    const projectContacts = useSelector(state => state.projectContacts)
    const [followedPeopleByProject, setFollowedPeopleByProject] = useState({})
    const followedWatchers = useRef(new Map())
    const followedBatcher = useRef(null)

    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)
    const projectsForContactsView = useMemo(
        () => getProjectsForContactsView(inAllProjects, loggedUserProjects, loggedUser),
        [inAllProjects, loggedUserProjects, loggedUser]
    )

    const writeBrowserURL = () => {
        if (inAllProjects) {
            URLsPeople.push(
                contactsActiveTab === ALL_TAB ? URL_ALL_PROJECTS_PEOPLE_ALL : URL_ALL_PROJECTS_PEOPLE_FOLLOWED
            )
        } else {
            const project = loggedUserProjects[selectedProjectIndex]
            URLsPeople.push(
                contactsActiveTab === ALL_TAB ? URL_PROJECT_PEOPLE_ALL : URL_PROJECT_PEOPLE_FOLLOWED,
                { projectId: project.id, userId: loggedUser.uid },
                project.id,
                loggedUser.uid
            )
        }
    }

    const { filteredProjectsUsers, filteredProjectsContacts, amounts } = useMemo(
        () =>
            buildContactsViewData({
                loggedUser,
                loggedUserProjects: projectsForContactsView,
                projectUsers,
                projectContacts,
                followedPeopleByProject,
                selectedTypeOfProject,
                selectedProjectIndex,
                contactsActiveTab,
                inAllProjects,
            }),
        [
            loggedUser,
            projectsForContactsView,
            projectUsers,
            projectContacts,
            followedPeopleByProject,
            selectedTypeOfProject,
            selectedProjectIndex,
            contactsActiveTab,
            inAllProjects,
        ]
    )

    useEffect(() => {
        dispatch(setNavigationRoute(DV_TAB_ROOT_CONTACTS))
    }, [])

    useEffect(() => {
        followedBatcher.current = createFollowedPeopleBatcher(updates => {
            setFollowedPeopleByProject(current => ({ ...current, ...updates }))
        })
        return () => {
            followedBatcher.current?.cancel()
            followedBatcher.current = null
            followedWatchers.current.forEach(watcher => {
                watcher.finishLoading()
                watcher.unsubscribe()
            })
            followedWatchers.current.clear()
        }
    }, [loggedUser.uid])

    useEffect(() => {
        writeBrowserURL()
    }, [contactsActiveTab, selectedProjectIndex])

    const project = inAllProjects ? ALL_PROJECTS_INDEX : loggedUserProjects[selectedProjectIndex]

    const sortedLoggedUserProjects = useMemo(() => {
        const normalProjects = projectsForContactsView.filter(project => !project.parentTemplateId)
        const guides = projectsForContactsView.filter(project => !!project.parentTemplateId)
        const getLastEditedContactDate = projectId => {
            const contacts = projectContacts[projectId] || []
            return contacts.reduce((maxDate, contact) => Math.max(maxDate, contact?.lastEditionDate || 0), 0)
        }
        const sortProjects = projects =>
            orderBy(
                sortBy(projects, [project => project.name.toLowerCase()]),
                [project => getLastEditedContactDate(project.id)],
                ['desc']
            )

        return [...sortProjects(normalProjects), ...sortProjects(guides)]
    }, [projectsForContactsView, projectContacts])

    const sortedProjectIds = useMemo(
        () => sortedLoggedUserProjects.map(project => project.id),
        [sortedLoggedUserProjects]
    )
    const projectMembershipKey = useMemo(() => [...sortedProjectIds].sort().join('\u001f'), [sortedProjectIds])
    const selectedProjectId = inAllProjects ? null : loggedUserProjects[selectedProjectIndex]?.id
    const projectRevealKey = `${inAllProjects ? 'all' : selectedProjectId}:${projectMembershipKey}`
    const projectRevealKeyRef = useRef(projectRevealKey)
    projectRevealKeyRef.current = projectRevealKey
    const [projectReadiness, setProjectReadiness] = useState({ key: projectRevealKey, projectIds: [] })
    const readyProjectIds = projectReadiness.key === projectRevealKey ? projectReadiness.projectIds : []
    const markProjectReady = useCallback(projectId => {
        setProjectReadiness(current => {
            const key = projectRevealKeyRef.current
            const projectIds = current.key === key ? current.projectIds : []
            if (projectIds.includes(projectId)) return current
            return { key, projectIds: [...projectIds, projectId] }
        })
    }, [])
    const { revealedProjectIds, primaryProjectId, complete } = useRateLimitedProjectReveal({
        projectIds: inAllProjects ? sortedProjectIds : [],
        readyProjectIds,
        resetKey: projectRevealKey,
    })
    const revealedProjectIdsSet = useMemo(() => new Set(revealedProjectIds), [revealedProjectIds])
    const visibleProjects = inAllProjects
        ? sortedLoggedUserProjects.filter(project => revealedProjectIdsSet.has(project.id))
        : [loggedUserProjects[selectedProjectIndex]].filter(Boolean)
    const trackedProjectId = inAllProjects ? primaryProjectId : selectedProjectId
    const visibleProjectIdsKey = visibleProjects.map(project => project.id).join('|')
    const requiredFollowedProjectIds = inAllProjects ? sortedProjectIds : selectedProjectId ? [selectedProjectId] : []
    const requiredFollowedProjectIdsKey = requiredFollowedProjectIds.join('\u001f')
    const followedReadinessKey = `${loggedUser.uid}:${contactsActiveTab}:${requiredFollowedProjectIdsKey}`
    const followedReadinessKeyRef = useRef(followedReadinessKey)
    followedReadinessKeyRef.current = followedReadinessKey
    const [followedReadiness, setFollowedReadiness] = useState({ key: followedReadinessKey, projectIds: [] })
    const followedReadyProjectIds = followedReadiness.key === followedReadinessKey ? followedReadiness.projectIds : []
    const markFollowedProjectReady = useCallback(projectId => {
        setFollowedReadiness(current => {
            const key = followedReadinessKeyRef.current
            const projectIds = current.key === key ? current.projectIds : []
            if (projectIds.includes(projectId)) return current
            return { key, projectIds: [...projectIds, projectId] }
        })
    }, [])
    const followedProjectsComplete =
        contactsActiveTab !== FOLLOWED_TAB ||
        requiredFollowedProjectIds.every(projectId => followedReadyProjectIds.includes(projectId))
    const selectedProjectReady =
        (!selectedProjectId || readyProjectIds.includes(selectedProjectId)) && followedProjectsComplete

    useEffect(() => {
        const projects = contactsActiveTab === FOLLOWED_TAB ? visibleProjects : []
        const desiredProjectIds = new Set(projects.map(project => project.id))

        followedWatchers.current.forEach((watcher, projectId) => {
            if (desiredProjectIds.has(projectId)) return
            watcher.finishLoading()
            watcher.unsubscribe()
            followedWatchers.current.delete(projectId)
        })
        projects.forEach(project => {
            if (followedWatchers.current.has(project.id)) return
            let loadingActive = project.id === trackedProjectId
            if (loadingActive) dispatch(startLoadingData())
            const finishLoading = () => {
                if (!loadingActive) return
                loadingActive = false
                dispatch(stopLoadingData())
            }
            const unsubscribe = watchFollowedPeople(
                project.id,
                loggedUser.uid,
                (projectId, followedPeople) => followedBatcher.current?.add(projectId, followedPeople),
                {
                    trackConnectionHealth: project.id === trackedProjectId,
                    onInitialSnapshot: projectId => {
                        finishLoading()
                        markFollowedProjectReady(projectId)
                    },
                }
            )
            followedWatchers.current.set(project.id, { unsubscribe, finishLoading })
        })
    }, [contactsActiveTab, dispatch, loggedUser.uid, selectedProjectIndex, trackedProjectId, visibleProjectIdsKey])

    const contactsAmount = amounts.users + amounts.contacts
    const followedContactsAmount = amounts.followedUsers + amounts.followedContacts
    const displayedContactsAmount = contactsActiveTab === FOLLOWED_TAB ? followedContactsAmount : contactsAmount

    return (
        <View
            style={[
                localStyles.container,
                inAllProjects && localStyles.containerSpace,
                smallScreenNavigation ? localStyles.containerMobile : isMiddleScreen && localStyles.containerTablet,
            ]}
        >
            {inAllProjects && <AllProjectsLine showActions={false} />}
            {inAllProjects && (
                <ContactsHeader
                    contactAmount={contactsActiveTab === FOLLOWED_TAB ? followedContactsAmount : contactsAmount}
                />
            )}
            {inAllProjects && <ContactStatusFiltersView projectContacts={projectContacts} />}

            <HashtagFiltersView />

            {visibleProjects.map(project => (
                <ContactsProjectLoader
                    key={`contacts-loader-${project.id}`}
                    projectId={project.id}
                    trackInitialLoad={project.id === trackedProjectId}
                    onInitialSnapshot={markProjectReady}
                />
            ))}

            {inAllProjects ? (
                visibleProjects.map((project, index) =>
                    filteredProjectsUsers[project.id] ? (
                        <ContactListByProject
                            key={project.id}
                            projectIndex={project.index}
                            members={filteredProjectsUsers[project.id]}
                            contacts={filteredProjectsContacts[project.id]}
                            onlyMembers={false}
                            firstProject={index === 0}
                            maxContactsToRender={3}
                            requestProjectData={false}
                        />
                    ) : null
                )
            ) : displayedContactsAmount > 0 ? (
                <ContactListByProject
                    projectIndex={selectedProjectIndex}
                    members={filteredProjectsUsers[project.id]}
                    contacts={filteredProjectsContacts[project.id]}
                    onlyMembers={false}
                    maxContactsToRender={10}
                    requestProjectData={false}
                />
            ) : selectedProjectReady ? (
                <NothingToShow />
            ) : null}
            {inAllProjects && complete && followedProjectsComplete && displayedContactsAmount === 0 && (
                <NothingToShow />
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        marginHorizontal: 104,
    },
    containerSpace: {
        marginBottom: 32,
    },
    containerMobile: {
        marginHorizontal: 16,
    },
    containerTablet: {
        marginHorizontal: 56,
    },
})
