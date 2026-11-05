import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import NotesHeader from './NotesHeader'
import ProjectHelper, {
    checkIfSelectedAllProjects,
    checkIfSelectedProject,
} from '../SettingsView/ProjectsSettings/ProjectHelper'
import NotesByProject from './NotesByProject'
import URLsNotes, {
    URL_ALL_PROJECTS_NOTES_ALL,
    URL_ALL_PROJECTS_NOTES_FOLLOWED,
    URL_PROJECT_USER_NOTES_ALL,
    URL_PROJECT_USER_NOTES_FOLLOWED,
} from '../../URLSystem/Notes/URLsNotes'
import { calcNotesAmount } from './NotesHelper'
import { setNavigationRoute, resetNotesAmounts } from '../../redux/actions'
import { ALL_TAB } from '../Feeds/Utils/FeedsConstants'
import { DV_TAB_ROOT_NOTES } from '../../utils/TabNavigationConstants'
import EmptyNotesAllProjects from './EmptyNotesAllProjects'
import HashtagFiltersView from '../HashtagFilters/HashtagFiltersView'
import { useDispatch, useSelector } from 'react-redux'
import store from '../../redux/store'
import AllProjectsLine from '../TaskListView/Header/AllProjectsLine/AllProjectsLine'
import AllProjectsAssistantLine from '../MyDayView/AssistantLine/AllProjectsAssistantLine'
import useRateLimitedProjectReveal from '../../hooks/useRateLimitedProjectReveal'
import useNearViewportMount from '../../hooks/useNearViewportMount'
import NotesListSkeleton from './NotesListSkeleton'
import Backend from '../../utils/BackendBridge'
import {
    NO_NOTE_EDITION_DATE,
    applyProbedEditionDates,
    excludeGuideProjects,
    probeProjectsLastNoteEdit,
    sortProjectsByLastNoteEdit,
} from './notesProjectOrder'

export const DEFAULT_MAX_NOTES_TO_RENDER = 10
export const FILTERED_MAX_NOTES_TO_RENDER = 50
export const NOTES_PROJECT_REVEAL_ROOT_MARGIN = '0px'
export const NOTES_PROJECT_GHOST_MIN_VISIBLE_MS = 200

function DeferredProjectReveal({ projectId, revealed, loading, observe, onNearViewport, children }) {
    const { placeholderRef, isNearViewport } = useNearViewportMount({
        eager: revealed,
        enabled: observe,
        rootMargin: NOTES_PROJECT_REVEAL_ROOT_MARGIN,
        trackVisibility: true,
    })

    useEffect(() => {
        if (observe) onNearViewport(projectId, isNearViewport)
    }, [isNearViewport, observe, onNearViewport, projectId])

    return (
        <View ref={placeholderRef} style={!revealed && localStyles.deferredProjectReveal}>
            {(revealed || loading) && <View style={!revealed && localStyles.preloadedProject}>{children}</View>}
            {!revealed && observe && <NotesListSkeleton rowCount={3} showProjectHeader />}
        </View>
    )
}

function NotesView() {
    const dispatch = useDispatch()
    const [tNotesAmount, setTNotesAmount] = useState(null)
    const sortedProjects = useRef({})
    const [sortedLoggedUserProjects, setSortedLoggedUserProjects] = useState([])
    // AT-2964: false while the per-project "last note edit" probes run. The board waits for
    // them (bounded by PROJECT_ORDER_PROBE_TIMEOUT_MS) so it opens already in the right order.
    const [projectOrderReady, setProjectOrderReady] = useState(false)
    const projectOrderRequestRef = useRef(0)
    const notesActiveTab = useSelector(state => state.notesActiveTab)
    const loggedUserProjects = useSelector(state => state.loggedUserProjects)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const notesAmounts = useSelector(state => state.notesAmounts)
    const selectedProjectIndex = useSelector(state => state.selectedProjectIndex)
    const selectedTab = useSelector(state => state.selectedSidebarTab)
    const currentUser = useSelector(state => state.currentUser)
    const noteOwnerFilters = useSelector(state => state.noteOwnerFilters)

    const inAllProjects = checkIfSelectedAllProjects(selectedProjectIndex)
    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)
    const sortedProjectIds = useMemo(
        () => sortedLoggedUserProjects.map(project => project.id),
        [sortedLoggedUserProjects]
    )
    const projectMembershipKey = useMemo(() => [...sortedProjectIds].sort().join('\u001f'), [sortedProjectIds])
    const projectRevealKey = `${notesActiveTab}:${selectedProjectIndex}:${projectOrderReady}:${projectMembershipKey}`
    const [projectReadiness, setProjectReadiness] = useState({ key: projectRevealKey, projectIds: [] })
    const readyProjectIds = projectReadiness.key === projectRevealKey ? projectReadiness.projectIds : []
    const markProjectReady = useCallback(
        projectId => {
            setProjectReadiness(current => {
                const projectIds = current.key === projectRevealKey ? current.projectIds : []
                if (projectIds.includes(projectId)) return current
                return { key: projectRevealKey, projectIds: [...projectIds, projectId] }
            })
        },
        [projectRevealKey]
    )
    const { revealedProjectIds, primaryProjectId, nextProjectId, loadingProjectId, markProjectNearViewport } =
        useRateLimitedProjectReveal({
            projectIds: inAllProjects && projectOrderReady ? sortedProjectIds : [],
            readyProjectIds,
            resetKey: projectRevealKey,
            requireNearViewport: inAllProjects,
            minIntervalMs: inAllProjects ? NOTES_PROJECT_GHOST_MIN_VISIBLE_MS : undefined,
        })
    const revealedProjectIdsSet = useMemo(() => new Set(revealedProjectIds), [revealedProjectIds])
    const visibleProjects = sortedLoggedUserProjects.filter(project => revealedProjectIdsSet.has(project.id))
    const visibleProjectIndexes = useMemo(
        () => new Map(visibleProjects.map((project, index) => [project.id, index])),
        [visibleProjects]
    )

    // The owner filter runs client-side over the notes already loaded, so widen the fetch
    // window while one is active. Without this, filtering a 10-note window by owner can show
    // an almost-empty list even when that owner has plenty of notes further back (AT-2194).
    const maxNotesToRender = noteOwnerFilters.length > 0 ? FILTERED_MAX_NOTES_TO_RENDER : DEFAULT_MAX_NOTES_TO_RENDER

    const projects = loggedUserProjects.filter(
        project => !templateProjectIds.includes(project.id) && !archivedProjectIds.includes(project.id)
    )

    useEffect(() => {
        return () => {
            projectOrderRequestRef.current += 1
            dispatch(resetNotesAmounts())
        }
    }, [])

    useEffect(() => {
        dispatch(setNavigationRoute(DV_TAB_ROOT_NOTES))
    }, [])

    useEffect(() => {
        const { loggedUser } = store.getState()
        dispatch(resetNotesAmounts())
        writeBrowserURL()
        const { rSortedProjects, rSortedLoggedUserProjects } = initSortedProjects(projects, loggedUser)
        setTNotesAmount(null)
        sortedProjects.current = rSortedProjects
        setSortedLoggedUserProjects(rSortedLoggedUserProjects)

        const requestId = ++projectOrderRequestRef.current
        if (!inAllProjects) {
            setProjectOrderReady(true)
            return
        }

        setProjectOrderReady(false)
        const followedOnly = notesActiveTab !== ALL_TAB
        probeProjectsLastNoteEdit(
            rSortedLoggedUserProjects.map(project => project.id),
            projectId => Backend.getLastNoteEditionDateInAllProjects(projectId, followedOnly)
        ).then(probedDates => {
            if (projectOrderRequestRef.current !== requestId) return
            const probedProjects = applyProbedEditionDates(Object.values(sortedProjects.current), probedDates)
            sortedProjects.current = Object.fromEntries(probedProjects.map(project => [project.id, project]))
            setSortedLoggedUserProjects(sortProjectsByLastNoteEdit(probedProjects))
            setProjectOrderReady(true)
        })
    }, [notesActiveTab, selectedProjectIndex])

    useEffect(() => {
        if (notesAmounts.length === projects.length && !notesAmounts.includes(undefined)) {
            setTNotesAmount(calcNotesAmount())
        }
    }, [notesAmounts])

    const writeBrowserURL = () => {
        if (inSelectedProject) {
            URLsNotes.push(
                notesActiveTab === ALL_TAB ? URL_PROJECT_USER_NOTES_ALL : URL_PROJECT_USER_NOTES_FOLLOWED,
                null,
                loggedUserProjects[selectedProjectIndex].id,
                currentUser.uid
            )
        } else {
            URLsNotes.push(
                notesActiveTab === ALL_TAB ? URL_ALL_PROJECTS_NOTES_ALL : URL_ALL_PROJECTS_NOTES_FOLLOWED,
                null
            )
        }
    }

    const setLastEditNoteDate = useCallback((project, date) => {
        // A block with no notes reports local-midnight 1970, which can be negative; treat any
        // non-positive date as "no note" so it ties with probed empty projects.
        const lastEditNoteDate = date > 0 ? date : NO_NOTE_EDITION_DATE
        const currentProject = sortedProjects.current[project.id]
        if (!currentProject || currentProject.lastEditNoteDate === lastEditNoteDate) return

        const rSortedProjects = {
            ...sortedProjects.current,
            [project.id]: { ...project, lastEditNoteDate },
        }

        sortedProjects.current = rSortedProjects
        setSortedLoggedUserProjects(sortProjectsByLastNoteEdit(Object.values(rSortedProjects)))
    }, [])

    return (
        <View
            style={[
                localStyles.container,
                inAllProjects && localStyles.containerSpace,
                smallScreenNavigation ? localStyles.containerMobile : isMiddleScreen && localStyles.containerTablet,
            ]}
        >
            {inAllProjects && <AllProjectsLine showActions={false} bottomSpacing={8} />}
            {inAllProjects && <AllProjectsAssistantLine />}
            {inAllProjects && <NotesHeader />}

            <HashtagFiltersView />

            <View>
                {inSelectedProject ? (
                    <NotesByProject
                        project={loggedUserProjects[selectedProjectIndex]}
                        filterBy={notesActiveTab}
                        maxNotesToRender={maxNotesToRender}
                        trackInitialLoad
                        key={loggedUserProjects[selectedProjectIndex].id}
                    />
                ) : !projectOrderReady ? (
                    <NotesListSkeleton rowCount={3} showProjectHeader />
                ) : notesAmounts.length === 0 || tNotesAmount == null || tNotesAmount > 0 ? (
                    sortedLoggedUserProjects.map(project => {
                        const revealed = revealedProjectIdsSet.has(project.id)
                        const loading = project.id === loadingProjectId
                        const observe = project.id === nextProjectId
                        if (!revealed && !observe) return null

                        return (
                            <DeferredProjectReveal
                                key={project.id}
                                projectId={project.id}
                                revealed={revealed}
                                loading={loading}
                                observe={observe}
                                onNearViewport={markProjectNearViewport}
                            >
                                <NotesByProject
                                    project={project}
                                    filterBy={notesActiveTab}
                                    firstProject={revealed && visibleProjectIndexes.get(project.id) === 0}
                                    maxNotesToRender={3}
                                    onInitialSnapshot={markProjectReady}
                                    setLastEditNoteDate={setLastEditNoteDate}
                                    showInitialSkeleton
                                    trackInitialLoad={project.id === primaryProjectId}
                                />
                            </DeferredProjectReveal>
                        )
                    })
                ) : (
                    <EmptyNotesAllProjects sortedActiveProjects={sortedLoggedUserProjects} />
                )}
            </View>
        </View>
    )
}

// Guides are not listed in All Projects > Notes (AT-2964). The default project order is the
// tie-breaker for projects without a readable note.
const initSortedProjects = (loggedUserProjects, user) => {
    const activeProjects = excludeGuideProjects(ProjectHelper.getActiveProjects2(loggedUserProjects, user), user)
    const projectsSorted = ProjectHelper.sortProjects(activeProjects, user.uid)

    const rSortedProjects = {}
    const rSortedLoggedUserProjects = []
    projectsSorted.forEach(project => {
        rSortedProjects[project.id] = { ...project, lastEditNoteDate: NO_NOTE_EDITION_DATE }
        rSortedLoggedUserProjects.push(rSortedProjects[project.id])
    })

    return { rSortedProjects, rSortedLoggedUserProjects }
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
        marginBottom: 25,
    },
    preloadedProject: {
        display: 'none',
    },
})

export default NotesView
