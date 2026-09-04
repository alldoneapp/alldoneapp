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
import {
    ensureProjectDataLoaded,
    PROJECT_DATA_CONTACTS,
    PROJECT_DATA_USERS,
} from '../../utils/InitialLoad/projectDataLoader'
import useRateLimitedProjectReveal from '../../hooks/useRateLimitedProjectReveal'
import {
    buildSecondaryViewCacheKey,
    getSecondaryViewCacheEntry,
    getSecondaryViewCacheEntrySync,
    SECONDARY_VIEW_CONTACTS,
    setSecondaryViewCacheEntry,
} from '../../utils/InitialLoad/secondaryViewCache'
import useNearViewportMount from '../../hooks/useNearViewportMount'
import ContactsListSkeleton from './ContactsListSkeleton'
import { isPendingContact } from '../../utils/backends/Contacts/pendingContact'

export const CONTACTS_ALL_PROJECTS_CACHE_ROWS = 3
export const CONTACTS_SELECTED_PROJECT_CACHE_ROWS = 10
export const CONTACTS_PROJECT_REVEAL_ROOT_MARGIN = '600px 0px'
export const CONTACTS_PROJECT_GHOST_MIN_VISIBLE_MS = 200

function DeferredContactsProject({ projectId, revealed, observe, onNearViewport, children }) {
    const { placeholderRef, isNearViewport } = useNearViewportMount({
        eager: revealed,
        enabled: observe,
        rootMargin: CONTACTS_PROJECT_REVEAL_ROOT_MARGIN,
        trackVisibility: true,
        activateWhenPassed: true,
    })

    useEffect(() => {
        if (observe) onNearViewport(projectId, isNearViewport)
    }, [isNearViewport, observe, onNearViewport, projectId])

    return (
        <View ref={placeholderRef} style={!revealed && localStyles.deferredProjectReveal}>
            {revealed ? children : observe ? <ContactsListSkeleton rowCount={3} /> : null}
        </View>
    )
}

const sortCachedContacts = (first, second) => {
    const dateDifference = (second.lastEditionDate || 0) - (first.lastEditionDate || 0)
    return dateDifference || (first.displayName || '').localeCompare(second.displayName || '')
}

export const getContactsViewCacheKey = ({ activeTab, inAllProjects, selectedProjectId, projectIds = [] }) =>
    buildSecondaryViewCacheKey(activeTab, inAllProjects ? 'all-projects' : selectedProjectId, [...projectIds].sort())

export const buildContactsViewCacheSnapshot = ({
    cacheKey,
    projects,
    filteredProjectsUsers,
    filteredProjectsContacts,
    amounts,
    rowsPerProject,
}) => {
    const projectsById = {}
    projects.forEach(project => {
        const members = filteredProjectsUsers[project.id] || []
        // AT-2508 - a contact still being written is a live, bounded state, not something to
        // remember. Caching it would replay "Adding person..." on the next mount for a contact
        // whose creation finished (or failed) long ago, with nothing left to retire the row.
        const contacts = (filteredProjectsContacts[project.id] || []).filter(contact => !isPendingContact(contact))
        const visibleRows = [...members, ...contacts].sort(sortCachedContacts).slice(0, rowsPerProject)
        projectsById[project.id] = {
            members: visibleRows.filter(contact => !contact.hasOwnProperty('recorderUserId')),
            contacts: visibleRows.filter(contact => contact.hasOwnProperty('recorderUserId')),
        }
    })
    return { cacheKey, projects: projectsById, amounts }
}

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

        ensureProjectDataLoaded(projectId, [PROJECT_DATA_USERS, PROJECT_DATA_CONTACTS], {
            trackConnectionHealth: trackInitialLoad,
        })
            .catch(() => false)
            .then(loaded => {
                if (!active) return
                finishLoading()
                onInitialSnapshot(projectId, loaded)
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
    const selectedProjectId = inAllProjects ? null : loggedUserProjects[selectedProjectIndex]?.id
    const contactsCacheKey = getContactsViewCacheKey({
        activeTab: contactsActiveTab,
        inAllProjects,
        selectedProjectId,
        projectIds: projectsForContactsView.map(project => project.id),
    })
    const [cachedViewSnapshot, setCachedViewSnapshot] = useState(() =>
        getSecondaryViewCacheEntrySync(loggedUser.uid, SECONDARY_VIEW_CONTACTS, contactsCacheKey)
    )

    useEffect(() => {
        let active = true
        const sessionSnapshot = getSecondaryViewCacheEntrySync(
            loggedUser.uid,
            SECONDARY_VIEW_CONTACTS,
            contactsCacheKey
        )
        setCachedViewSnapshot(sessionSnapshot)
        if (!sessionSnapshot) {
            getSecondaryViewCacheEntry(loggedUser.uid, SECONDARY_VIEW_CONTACTS, contactsCacheKey).then(snapshot => {
                if (active) setCachedViewSnapshot(snapshot)
            })
        }
        return () => {
            active = false
        }
    }, [contactsCacheKey, loggedUser.uid])

    const cachedProjects = cachedViewSnapshot?.cacheKey === contactsCacheKey ? cachedViewSnapshot.projects || {} : {}

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
            const liveContacts = projectContacts[projectId] || []
            const contacts = liveContacts.length > 0 ? liveContacts : cachedProjects[projectId]?.contacts || []
            return contacts.reduce((maxDate, contact) => Math.max(maxDate, contact?.lastEditionDate || 0), 0)
        }
        const sortProjects = projects =>
            orderBy(
                sortBy(projects, [project => project.name.toLowerCase()]),
                [project => getLastEditedContactDate(project.id)],
                ['desc']
            )

        return [...sortProjects(normalProjects), ...sortProjects(guides)]
    }, [cachedProjects, projectsForContactsView, projectContacts])

    const sortedProjectIds = useMemo(
        () => sortedLoggedUserProjects.map(project => project.id),
        [sortedLoggedUserProjects]
    )
    const projectMembershipKey = useMemo(() => [...sortedProjectIds].sort().join('\u001f'), [sortedProjectIds])
    const projectRevealKey = `${inAllProjects ? 'all' : selectedProjectId}:${projectMembershipKey}`
    const projectRevealKeyRef = useRef(projectRevealKey)
    projectRevealKeyRef.current = projectRevealKey
    const cachedProjectIds = Object.keys(
        cachedViewSnapshot?.cacheKey === contactsCacheKey ? cachedViewSnapshot.projects || {} : {}
    ).filter(projectId => sortedProjectIds.includes(projectId))
    const [projectReadiness, setProjectReadiness] = useState({
        key: projectRevealKey,
        projectIds: cachedProjectIds,
    })
    const readyProjectIds = projectReadiness.key === projectRevealKey ? projectReadiness.projectIds : []
    const [liveProjectReadiness, setLiveProjectReadiness] = useState({ key: projectRevealKey, projectIds: [] })
    const liveReadyProjectIds = liveProjectReadiness.key === projectRevealKey ? liveProjectReadiness.projectIds : []
    const markProjectReady = useCallback(projectId => {
        setProjectReadiness(current => {
            const key = projectRevealKeyRef.current
            const projectIds = current.key === key ? current.projectIds : []
            if (projectIds.includes(projectId)) return current
            return { key, projectIds: [...projectIds, projectId] }
        })
    }, [])
    const cachedProjectIdsKey = cachedProjectIds.join('\u001f')
    useEffect(() => {
        cachedProjectIds.forEach(markProjectReady)
    }, [cachedProjectIdsKey, markProjectReady])
    const markLiveProjectReady = useCallback(
        (projectId, loaded = true) => {
            markProjectReady(projectId)
            // A timeout/failure still releases the reveal queue, but it is not newer data. Keep
            // rendering the cached rows until a later live watcher delivery can replace them.
            if (!loaded) return
            setLiveProjectReadiness(current => {
                const key = projectRevealKeyRef.current
                const projectIds = current.key === key ? current.projectIds : []
                if (projectIds.includes(projectId)) return current
                return { key, projectIds: [...projectIds, projectId] }
            })
        },
        [markProjectReady]
    )
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
    const revealReadyProjectIds = readyProjectIds.filter(
        projectId =>
            cachedProjectIds.includes(projectId) ||
            contactsActiveTab !== FOLLOWED_TAB ||
            followedReadyProjectIds.includes(projectId)
    )
    const { revealedProjectIds, primaryProjectId, complete, nextProjectId, loadingProjectId, markProjectNearViewport } =
        useRateLimitedProjectReveal({
            projectIds: inAllProjects ? sortedProjectIds : [],
            readyProjectIds: revealReadyProjectIds,
            resetKey: projectRevealKey,
            requireNearViewport: inAllProjects,
            minIntervalMs: inAllProjects ? CONTACTS_PROJECT_GHOST_MIN_VISIBLE_MS : undefined,
        })
    const revealedProjectIdsSet = useMemo(() => new Set(revealedProjectIds), [revealedProjectIds])
    const visibleProjects = inAllProjects
        ? sortedLoggedUserProjects.filter(project => revealedProjectIdsSet.has(project.id))
        : [loggedUserProjects[selectedProjectIndex]].filter(Boolean)
    const admittedProjectIdsSet = useMemo(
        () => new Set([...revealedProjectIds, ...(loadingProjectId ? [loadingProjectId] : [])]),
        [loadingProjectId, revealedProjectIds]
    )
    const admittedProjects = inAllProjects
        ? sortedLoggedUserProjects.filter(project => admittedProjectIdsSet.has(project.id))
        : visibleProjects
    const trackedProjectId = inAllProjects ? primaryProjectId : selectedProjectId
    const admittedProjectIdsKey = admittedProjects.map(project => project.id).join('|')
    const followedProjectsComplete =
        contactsActiveTab !== FOLLOWED_TAB ||
        requiredFollowedProjectIds.every(projectId => followedReadyProjectIds.includes(projectId))
    const selectedProjectReady =
        (!selectedProjectId || readyProjectIds.includes(selectedProjectId)) && followedProjectsComplete

    useEffect(() => {
        const projects = contactsActiveTab === FOLLOWED_TAB ? admittedProjects : []
        const desiredProjectIds = new Set(projects.map(project => project.id))

        followedWatchers.current.forEach((watcher, projectId) => {
            if (desiredProjectIds.has(projectId)) return
            watcher.finishLoading()
            watcher.unsubscribe()
            followedWatchers.current.delete(projectId)
        })
        projects.forEach(project => {
            if (followedWatchers.current.has(project.id)) return
            let loadingActive = project.id === trackedProjectId && !cachedProjectIds.includes(project.id)
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
    }, [
        cachedProjectIdsKey,
        contactsActiveTab,
        dispatch,
        loggedUser.uid,
        selectedProjectIndex,
        trackedProjectId,
        admittedProjectIdsKey,
    ])
    const projectHasLiveRows = projectId =>
        liveReadyProjectIds.includes(projectId) &&
        (contactsActiveTab !== FOLLOWED_TAB || followedReadyProjectIds.includes(projectId))
    const renderedProjectsUsers = {}
    const renderedProjectsContacts = {}
    projectsForContactsView.forEach(project => {
        const useLiveRows = projectHasLiveRows(project.id) || !cachedProjects[project.id]
        renderedProjectsUsers[project.id] = useLiveRows
            ? filteredProjectsUsers[project.id] || []
            : cachedProjects[project.id].members || []
        renderedProjectsContacts[project.id] = useLiveRows
            ? filteredProjectsContacts[project.id] || []
            : cachedProjects[project.id].contacts || []
    })
    const requiredLiveProjectIds = inAllProjects ? sortedProjectIds : selectedProjectId ? [selectedProjectId] : []
    const allRequiredProjectsLive = requiredLiveProjectIds.every(projectHasLiveRows)
    const renderedAmounts =
        !allRequiredProjectsLive && cachedViewSnapshot?.cacheKey === contactsCacheKey
            ? cachedViewSnapshot.amounts || amounts
            : amounts
    const liveCacheProjectIds = requiredLiveProjectIds.filter(projectHasLiveRows)
    const liveCacheProjectIdsKey = liveCacheProjectIds.join('\u001f')

    useEffect(() => {
        // Persist each server-confirmed project as it arrives. Projects that have not been
        // admitted near the viewport keep their previous projection, so a partial refresh can
        // never erase the useful offline state for the rest of the board.
        if (projectsForContactsView.length === 0 || liveCacheProjectIds.length === 0) return
        const freshProjects = projectsForContactsView.filter(project => liveCacheProjectIds.includes(project.id))
        const freshSnapshot = buildContactsViewCacheSnapshot({
            cacheKey: contactsCacheKey,
            projects: freshProjects,
            filteredProjectsUsers,
            filteredProjectsContacts,
            amounts,
            rowsPerProject: inAllProjects ? CONTACTS_ALL_PROJECTS_CACHE_ROWS : CONTACTS_SELECTED_PROJECT_CACHE_ROWS,
        })
        const latestSnapshot =
            getSecondaryViewCacheEntrySync(loggedUser.uid, SECONDARY_VIEW_CONTACTS, contactsCacheKey) ||
            cachedViewSnapshot
        const mergedProjects = {}
        projectsForContactsView.forEach(project => {
            const projectSnapshot = freshSnapshot.projects[project.id] || latestSnapshot?.projects?.[project.id]
            if (projectSnapshot) mergedProjects[project.id] = projectSnapshot
        })
        const snapshot = {
            cacheKey: contactsCacheKey,
            projects: mergedProjects,
            amounts: allRequiredProjectsLive ? amounts : latestSnapshot?.amounts || renderedAmounts,
        }
        setSecondaryViewCacheEntry(loggedUser.uid, SECONDARY_VIEW_CONTACTS, contactsCacheKey, snapshot)
    }, [
        allRequiredProjectsLive,
        cachedViewSnapshot,
        contactsCacheKey,
        filteredProjectsContacts,
        filteredProjectsUsers,
        followedPeopleByProject,
        inAllProjects,
        liveCacheProjectIdsKey,
        loggedUser.uid,
        renderedAmounts,
        selectedProjectId,
    ])

    const contactsAmount = renderedAmounts.users + renderedAmounts.contacts
    const followedContactsAmount = renderedAmounts.followedUsers + renderedAmounts.followedContacts
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

            {admittedProjects.map(project => (
                <ContactsProjectLoader
                    key={`contacts-loader-${project.id}`}
                    projectId={project.id}
                    trackInitialLoad={project.id === trackedProjectId && !cachedProjects[project.id]}
                    onInitialSnapshot={markLiveProjectReady}
                />
            ))}

            {inAllProjects ? (
                sortedLoggedUserProjects.map(project => {
                    const revealed = revealedProjectIdsSet.has(project.id)
                    const observe = project.id === nextProjectId
                    if (!revealed && !observe) return null

                    return (
                        <DeferredContactsProject
                            key={project.id}
                            projectId={project.id}
                            revealed={revealed}
                            observe={observe}
                            onNearViewport={markProjectNearViewport}
                        >
                            <ContactListByProject
                                projectIndex={project.index}
                                members={renderedProjectsUsers[project.id]}
                                contacts={renderedProjectsContacts[project.id]}
                                onlyMembers={false}
                                firstProject={project.id === primaryProjectId}
                                maxContactsToRender={3}
                                requestProjectData={false}
                            />
                        </DeferredContactsProject>
                    )
                })
            ) : displayedContactsAmount > 0 ? (
                <ContactListByProject
                    projectIndex={selectedProjectIndex}
                    members={renderedProjectsUsers[project.id]}
                    contacts={renderedProjectsContacts[project.id]}
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
    deferredProjectReveal: {
        minHeight: 324,
    },
})
