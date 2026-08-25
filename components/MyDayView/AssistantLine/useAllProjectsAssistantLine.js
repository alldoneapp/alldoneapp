import { useCallback, useMemo } from 'react'
import { shallowEqual, useDispatch, useSelector } from 'react-redux'

import ProjectHelper from '../../SettingsView/ProjectsSettings/ProjectHelper'
import {
    hideWebSideBar,
    setAssistantLineAssistant,
    setSelectedSidebarTab,
    setSelectedTypeOfProject,
    setTaskViewToggleIndex,
    setTaskViewToggleSection,
    storeCurrentUser,
    storeLoggedUser,
    switchProject,
    switchShortcutProject,
    updateFeedActiveTab,
} from '../../../redux/actions'
import { updateShowAllProjectsByTime } from '../../../utils/backends/Users/usersFirestore'
import { FOLLOWED_TAB } from '../../Feeds/Utils/FeedsConstants'
import { DV_TAB_ROOT_TASKS } from '../../../utils/TabNavigationConstants'
import { useProjectsData } from '../../../hooks/useProjectData'
import { PROJECT_DATA_ASSISTANTS } from '../../../utils/InitialLoad/projectDataLoader'
import { buildAllProjectsAssistantGroups } from './assistantSwitchOptions'

const EMPTY_ARRAY = []
const EMPTY_OBJECT = {}

/**
 * AT-2430 — the switch scope of the home / start page's assistant line.
 *
 * Split from `useAssistantLineSwitch` (the per-project half) on purpose: enumerating projects
 * needs `ProjectHelper`, which reaches react-native-gesture-handler through ProjectsSettings, and
 * that must not land in the import graph of every project board.
 */

/** Active projects, in sidebar order — the same scope the all-projects task board renders. */
const useActiveProjects = () => {
    const projectIds = useSelector(state => state.loggedUser.projectIds, shallowEqual)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds, shallowEqual)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds, shallowEqual)
    const guideProjectIds = useSelector(state => state.loggedUser.guideProjectIds, shallowEqual)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const loggedUserProjectsMap = useSelector(state => state.loggedUserProjectsMap)

    return useMemo(() => {
        const loaded = (projectIds || []).map(projectId => loggedUserProjectsMap[projectId]).filter(Boolean)
        // Guides, templates and archived projects are out for the same reason the task board
        // excludes them (AT-2337): 64 of the reporting account's projects are guides.
        const active = ProjectHelper.getActiveProjects2(loaded, {
            projectIds: projectIds || [],
            archivedProjectIds: archivedProjectIds || [],
            templateProjectIds: templateProjectIds || [],
            guideProjectIds: guideProjectIds || [],
        })
        return ProjectHelper.sortProjects(active, loggedUserId)
    }, [projectIds, archivedProjectIds, templateProjectIds, guideProjectIds, loggedUserProjectsMap, loggedUserId])
}

/**
 * Moves the app to `option.projectId` with `option.assistantId` active in its assistant line.
 *
 * The dispatch list is the one the sidebar's own project click uses (`ProjectItem.onPress`), so
 * arriving here lands the user in exactly the state clicking that project would have, plus the
 * assistant choice. `showAllProjectsByTime` has to be cleared for the same reason it is there:
 * without it a user in MyDay switches project and is still looking at MyDay.
 */
const useSwitchToProjectWithAssistant = () => {
    const dispatch = useDispatch()
    const loggedUser = useSelector(state => state.loggedUser)
    const loggedUserProjectsMap = useSelector(state => state.loggedUserProjectsMap)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    return useCallback(
        option => {
            const project = option && loggedUserProjectsMap[option.projectId]
            if (!project) return

            dispatch(storeLoggedUser({ ...loggedUser, showAllProjectsByTime: false }))
            updateShowAllProjectsByTime(loggedUser.uid, false)

            const dispatches = [
                setAssistantLineAssistant(option.projectId, option.assistantId),
                switchProject(project.index),
                updateFeedActiveTab(FOLLOWED_TAB),
                storeCurrentUser(loggedUser),
                setSelectedTypeOfProject(ProjectHelper.getTypeOfProject(loggedUser, project.id)),
                switchShortcutProject(null),
                setSelectedSidebarTab(DV_TAB_ROOT_TASKS),
                setTaskViewToggleIndex(0),
                setTaskViewToggleSection('Open'),
            ]

            if (smallScreenNavigation) dispatches.push(hideWebSideBar())

            dispatch(dispatches)
        },
        [dispatch, loggedUser, loggedUserProjectsMap, smallScreenNavigation]
    )
}

/**
 * The home / "All projects" assistant line always speaks as the default assistant, so it needs no
 * selection state of its own — any OTHER choice means leaving the home page for that assistant's
 * project, which is where the per-project selection then lives.
 */
export const useAllProjectsAssistantLine = () => {
    const defaultProjectId = useSelector(state => state.loggedUser?.defaultProjectId)
    const defaultAssistant = useSelector(state => state.defaultAssistant)
    const globalAssistants = useSelector(state => state.globalAssistants || EMPTY_ARRAY, shallowEqual)
    const assistantsByProject = useSelector(state => state.projectAssistants || EMPTY_OBJECT)
    const projects = useActiveProjects()
    const switchToProjectWithAssistant = useSwitchToProjectWithAssistant()

    const projectIds = useMemo(() => projects.map(project => project.id), [projects])

    // AT-2386 left `projectAssistants` loaded per project on demand, so a list that spans every
    // project has to say it needs them. Deliberately armed from the line's own mount rather than
    // when the popup opens: the button's very existence depends on the option COUNT, and a
    // control that only appears after you have pressed it is not a control. The cost is bounded
    // and small — one watcher per ACTIVE project (14 on the reporting account, 33 documents in
    // total), armed after first paint and idempotent process-wide, not the 56 login-blocking
    // collection reads that ticket removed.
    useProjectsData(projectIds, PROJECT_DATA_ASSISTANTS)

    const groups = useMemo(
        () =>
            buildAllProjectsAssistantGroups({
                projects,
                assistantsByProject,
                globalAssistants,
                defaultProjectId,
            }),
        [projects, assistantsByProject, globalAssistants, defaultProjectId]
    )

    const activeAssistantId = defaultAssistant?.uid || null

    const onSelect = useCallback(
        option => {
            if (!option) return
            // Selecting the assistant that is already answering here keeps the user on the home
            // page — only a DIFFERENT assistant means "take me to its project".
            if (option.assistantId === activeAssistantId && option.projectId === defaultProjectId) return
            switchToProjectWithAssistant(option)
        },
        [activeAssistantId, defaultProjectId, switchToProjectWithAssistant]
    )

    return useMemo(
        () => ({
            groups,
            grouped: true,
            activeProjectId: defaultProjectId || null,
            activeAssistantId,
            onSelect,
        }),
        [groups, defaultProjectId, activeAssistantId, onSelect]
    )
}
