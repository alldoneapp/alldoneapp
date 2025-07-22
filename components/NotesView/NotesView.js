import React, { useEffect, useRef, useState } from 'react'
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
import { resetLoadingData, setNavigationRoute, updateNotesActiveTab, resetNotesAmounts } from '../../redux/actions'
import MultiToggleSwitch from '../UIControls/MultiToggleSwitch/MultiToggleSwitch'
import { ALL_TAB } from '../Feeds/Utils/FeedsConstants'
import moment from 'moment'
import { DV_TAB_ROOT_NOTES } from '../../utils/TabNavigationConstants'
import EmptyNotesAllProjects from './EmptyNotesAllProjects'
import HashtagFiltersView from '../HashtagFilters/HashtagFiltersView'
import { useDispatch, useSelector } from 'react-redux'
import store from '../../redux/store'
import { checkIfThereAreNewComments } from '../ChatsView/Utils/ChatHelper'

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
    const projectChatNotifications = useSelector(state => state.projectChatNotifications)

    const thereAreNewComments = checkIfThereAreNewComments(
        projectChatNotifications,
        sortedLoggedUserProjects.map(project => project.id)
    )

    const inSelectedProject = checkIfSelectedProject(selectedProjectIndex)

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

    const setLastEditNoteDate = (project, date) => {
        const rSortedProjects = { ...sortedProjects.current }
        rSortedProjects[project.id] = { ...project, lastEditNoteDate: date }

        const rSortedLoggedUserProjects = Object.values(rSortedProjects).sort(
            (a, b) => (a.lastEditNoteDate - b.lastEditNoteDate) * -1
        )

        sortedProjects.current = rSortedProjects

        const normalProjects = rSortedLoggedUserProjects.filter(project => !project.parentTemplateId)
        const guides = rSortedLoggedUserProjects.filter(project => !!project.parentTemplateId)
        setSortedLoggedUserProjects([...normalProjects, ...guides])
    }

    return (
        <View
            style={[
                localStyles.container,
                checkIfSelectedAllProjects(selectedProjectIndex) && localStyles.containerSpace,
                smallScreenNavigation ? localStyles.containerMobile : isMiddleScreen && localStyles.containerTablet,
            ]}
        >
            <NotesHeader />

            <View style={localStyles.toggleSwitch}>
                <MultiToggleSwitch
                    options={[
                        { icon: 'eye', text: 'Followed', badge: null },
                        { icon: 'several-file-text', text: 'All', badge: null },
                    ]}
                    currentIndex={notesActiveTab}
                    onChangeOption={index => {
                        dispatch(updateNotesActiveTab(index))
                    }}
                />
            </View>

            <HashtagFiltersView />

            <View>
                {inSelectedProject ? (
                    <NotesByProject
                        project={loggedUserProjects[selectedProjectIndex]}
                        filterBy={notesActiveTab}
                        maxNotesToRender={10}
                        key={loggedUserProjects[selectedProjectIndex].id}
                    />
                ) : thereAreNewComments || notesAmounts.length === 0 || tNotesAmount == null || tNotesAmount > 0 ? (
                    sortedLoggedUserProjects.map((project, index) => (
                        <NotesByProject
                            key={project.id}
                            project={project}
                            filterBy={notesActiveTab}
                            firstProject={index === 0}
                            maxNotesToRender={3}
                            setLastEditNoteDate={date => setLastEditNoteDate(project, date)}
                        />
                    ))
                ) : (
                    <EmptyNotesAllProjects sortedActiveProjects={sortedLoggedUserProjects} />
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
    toggleSwitch: {
        position: 'absolute',
        right: 0,
        top: 44,
        zIndex: 10,
    },
})

export default NotesView
