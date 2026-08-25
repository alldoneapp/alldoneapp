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
import { resetLoadingData, setNavigationRoute, resetNotesAmounts } from '../../redux/actions'
import { ALL_TAB } from '../Feeds/Utils/FeedsConstants'
import moment from 'moment'
import { DV_TAB_ROOT_NOTES } from '../../utils/TabNavigationConstants'
import EmptyNotesAllProjects from './EmptyNotesAllProjects'
import HashtagFiltersView from '../HashtagFilters/HashtagFiltersView'
import { useDispatch, useSelector } from 'react-redux'
import store from '../../redux/store'
import AllProjectsLine from '../TaskListView/Header/AllProjectsLine/AllProjectsLine'
import useRateLimitedProjectReveal from '../../hooks/useRateLimitedProjectReveal'
import useNearViewportMount from '../../hooks/useNearViewportMount'
import NotesListSkeleton from './NotesListSkeleton'

export const DEFAULT_MAX_NOTES_TO_RENDER = 10
export const FILTERED_MAX_NOTES_TO_RENDER = 50
export const NOTES_PROJECT_REVEAL_ROOT_MARGIN = '0px'

function DeferredProjectReveal({ projectId, onNearViewport }) {
    const { placeholderRef, isNearViewport } = useNearViewportMount({
        rootMargin: NOTES_PROJECT_REVEAL_ROOT_MARGIN,
    })

    useEffect(() => {
        if (isNearViewport) onNearViewport(projectId)
    }, [isNearViewport, onNearViewport, projectId])

    return (
        <View ref={placeholderRef} style={localStyles.deferredProjectReveal}>
            <NotesListSkeleton rowCount={3} showProjectHeader />
        </View>
    )
}

function NotesView() {
    const dispatch = useDispatch()
    const [tNotesAmount, setTNotesAmount] = useState(null)
    const sortedProjects = useRef({})
    const [sortedLoggedUserProjects, setSortedLoggedUserProjects] = useState([])
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
    const projectRevealKey = `${notesActiveTab}:${selectedProjectIndex}:${projectMembershipKey}`
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
    const { revealedProjectIds, primaryProjectId, nextProjectId, markProjectNearViewport } =
        useRateLimitedProjectReveal({
            projectIds: inAllProjects ? sortedProjectIds : [],
            readyProjectIds,
            resetKey: projectRevealKey,
            requireNearViewport: inAllProjects,
        })
    const revealedProjectIdsSet = useMemo(() => new Set(revealedProjectIds), [revealedProjectIds])
    const visibleProjects = sortedLoggedUserProjects.filter(project => revealedProjectIdsSet.has(project.id))

    // The owner filter runs client-side over the notes already loaded, so widen the fetch
    // window while one is active. Without this, filtering a 10-note window by owner can show
    // an almost-empty list even when that owner has plenty of notes further back (AT-2194).
    const maxNotesToRender = noteOwnerFilters.length > 0 ? FILTERED_MAX_NOTES_TO_RENDER : DEFAULT_MAX_NOTES_TO_RENDER

    const projects = loggedUserProjects.filter(
        project => !templateProjectIds.includes(project.id) && !archivedProjectIds.includes(project.id)
    )

    useEffect(() => {
        dispatch([resetLoadingData()])
        return () => dispatch([resetLoadingData(), resetNotesAmounts()])
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

        const normalProjects = rSortedLoggedUserProjects.filter(project => !project.parentTemplateId)
        const guides = rSortedLoggedUserProjects.filter(project => !!project.parentTemplateId)
        setSortedLoggedUserProjects([...normalProjects, ...guides])
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
        const currentProject = sortedProjects.current[project.id]
        if (!currentProject || currentProject.lastEditNoteDate === date) return

        const rSortedProjects = {
            ...sortedProjects.current,
            [project.id]: { ...project, lastEditNoteDate: date },
        }

        const rSortedLoggedUserProjects = Object.values(rSortedProjects).sort(
            (a, b) => (a.lastEditNoteDate - b.lastEditNoteDate) * -1
        )

        sortedProjects.current = rSortedProjects

        const normalProjects = rSortedLoggedUserProjects.filter(project => !project.parentTemplateId)
        const guides = rSortedLoggedUserProjects.filter(project => !!project.parentTemplateId)
        setSortedLoggedUserProjects([...normalProjects, ...guides])
    }, [])

    return (
        <View
            style={[
                localStyles.container,
                inAllProjects && localStyles.containerSpace,
                smallScreenNavigation ? localStyles.containerMobile : isMiddleScreen && localStyles.containerTablet,
            ]}
        >
            {inAllProjects && <AllProjectsLine showActions={false} />}
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
                ) : notesAmounts.length === 0 || tNotesAmount == null || tNotesAmount > 0 ? (
                    visibleProjects.map((project, index) => (
                        <NotesByProject
                            key={project.id}
                            project={project}
                            filterBy={notesActiveTab}
                            firstProject={index === 0}
                            maxNotesToRender={3}
                            onInitialSnapshot={markProjectReady}
                            setLastEditNoteDate={setLastEditNoteDate}
                            showInitialSkeleton
                            trackInitialLoad={project.id === primaryProjectId}
                        />
                    ))
                ) : (
                    <EmptyNotesAllProjects sortedActiveProjects={sortedLoggedUserProjects} />
                )}
                {inAllProjects && nextProjectId && (
                    <DeferredProjectReveal
                        key={nextProjectId}
                        projectId={nextProjectId}
                        onNearViewport={markProjectNearViewport}
                    />
                )}
            </View>
        </View>
    )
}

const initSortedProjects = (loggedUserProjects, user) => {
    const activeProjects = ProjectHelper.getActiveProjects2(loggedUserProjects, user)
    const guides = ProjectHelper.getGuideProjects(loggedUserProjects, user)

    const projectsSorted = [
        ...ProjectHelper.sortProjects(activeProjects, user.uid),
        ...ProjectHelper.sortProjects(guides, user.uid),
    ]
    const rSortedProjects = {}
    const rSortedLoggedUserProjects = []
    const initialLastEditNoteDate = moment('01-01-1970', 'DD-MM-YYYY').valueOf()
    projectsSorted.forEach(project => {
        rSortedProjects[project.id] = { ...project, lastEditNoteDate: initialLastEditNoteDate }
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
})

export default NotesView
