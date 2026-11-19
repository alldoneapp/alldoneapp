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
import {
    buildAllProjectsAssistantGroups,
    buildProjectScopeAssistantGroups,
    isAllProjectsAssistantOption,
} from './assistantSwitchOptions'
import useDeferredStartupWork from '../../../hooks/useDeferredStartupWork'
import navigateToHome from '../../../utils/navigateToHome'

const EMPTY_ARRAY = []
const EMPTY_OBJECT = {}

/**
 * AT-2430 — the switch scope of the home / start page's assistant line.
 *
 * Split from `useAssistantLineSwitch` (the per-project half) on purpose: enumerating projects
 * needs `ProjectHelper`, which reaches react-native-gesture-handler through ProjectsSettings, and
 * that must not land in the import graph of every project board.
 *
 * AT-3093: `AssistantLine` imports this module for `useProjectScopeAssistantSwitch`. That adds
 * nothing new to its graph: the line already reaches `ProjectHelper` through
 * `AssistantOptions/helper.js`. `useProjectAssistantLine` itself, which the task boards and modals
 * mount without rendering a line, still stays free of it.
 */

/** Active projects, in sidebar order — the same scope the all-projects task board renders. */
const useActiveProjects = (enabled = true) => {
    const projectIds = useSelector(state => state.loggedUser.projectIds, shallowEqual)
    const archivedProjectIds = useSelector(state => state.loggedUser.archivedProjectIds, shallowEqual)
    const templateProjectIds = useSelector(state => state.loggedUser.templateProjectIds, shallowEqual)
    const guideProjectIds = useSelector(state => state.loggedUser.guideProjectIds, shallowEqual)
    const loggedUserId = useSelector(state => state.loggedUser.uid)
    const loggedUserProjectsMap = useSelector(state => state.loggedUserProjectsMap)

    return useMemo(() => {
        if (!enabled) return EMPTY_ARRAY
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
    }, [
        enabled,
        projectIds,
        archivedProjectIds,
        templateProjectIds,
        guideProjectIds,
        loggedUserProjectsMap,
        loggedUserId,
    ])
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
 * AT-3093 follow-up — back to All Projects, where the line speaks as the default assistant.
 *
 * Reuses `navigateToHome`, the "All projects" navigation of the Anna top strip's home button, so
 * this lands exactly where that button does (the All Projects open task list). The sidebar is
 * hidden on small screens for the same reason `useSwitchToProjectWithAssistant` hides it.
 */
const useSwitchToAllProjects = () => {
    const dispatch = useDispatch()
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    return useCallback(() => {
        navigateToHome(dispatch)
        if (smallScreenNavigation) dispatch(hideWebSideBar())
    }, [dispatch, smallScreenNavigation])
}

/**
 * The assistants of every active project, grouped by project in the All Projects order. Shared by
 * the home line and (AT-3093) the in-project line, so both popups list exactly the same set.
 *
 * With `enabled` off nothing is read or loaded: the in-project line mounts this hook on every
 * board, including the ones where its switch is the home line's.
 */
const useAllProjectsAssistantGroups = ({ enabled = true } = {}) => {
    const defaultProjectId = useSelector(state => state.loggedUser?.defaultProjectId)
    const globalAssistants = useSelector(state => (enabled && state.globalAssistants) || EMPTY_ARRAY, shallowEqual)
    const assistantsByProject = useSelector(state => (enabled && state.projectAssistants) || EMPTY_OBJECT)
    const projects = useActiveProjects(enabled)
    const deferredStartupWorkReady = useDeferredStartupWork({ enabled })

    const projectIds = useMemo(() => projects.map(project => project.id), [projects])

    // AT-2386 left `projectAssistants` loaded per project on demand, so a list that spans every
    // project has to say it needs them. This used to fan out at the same moment as the task
    // listeners (14 extra collection reads on the reporting account). Keep the default
    // assistant, which was loaded during boot, immediately usable and fill the switch only after
    // the first task stream has published. The fallback in useDeferredStartupWork also covers a
    // direct route that never mounts a task board. The loader shares one watcher per project, so
    // the home line and a project line asking for the same projects cost nothing extra.
    useProjectsData(projectIds, PROJECT_DATA_ASSISTANTS, { enabled: enabled && deferredStartupWorkReady })

    return useMemo(
        () =>
            enabled
                ? buildAllProjectsAssistantGroups({
                      projects,
                      assistantsByProject,
                      globalAssistants,
                      defaultProjectId,
                  })
                : EMPTY_ARRAY,
        [enabled, projects, assistantsByProject, globalAssistants, defaultProjectId]
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
    const groups = useAllProjectsAssistantGroups()
    const switchToProjectWithAssistant = useSwitchToProjectWithAssistant()

    const activeAssistantId = defaultAssistant?.uid || null

    const onSelect = useCallback(
        option => {
            if (!option) return
            // Selecting the assistant that is already answering here keeps the user on the home
            // page — only a DIFFERENT assistant means "take me to its project".
            if (isAllProjectsAssistantOption(option, defaultProjectId, activeAssistantId)) return
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

/**
 * AT-3093 — the in-project line's switch, widened to the All Projects popup.
 *
 * `projectSwitch` is what `useProjectAssistantLine` built (`scope: 'project'`): this project's
 * assistants and an `onSelect` that only changes who answers here. Anything else (the home
 * line's switch, or none) is returned untouched, and nothing is loaded for it.
 *
 * A choice inside the current project's group keeps that in-place behaviour: a session-only
 * selection (`setAssistantLineAssistant`), never a write to the project's configured assistant.
 * A choice from another project does what it does on the home page and moves the user to that
 * project with the assistant active. It cannot stay here: the server resolves a chat's assistant
 * from the chat's project, the global assistants and the user's default project only
 * (`getAssistantForChat`), so another project's assistant would silently answer as the default.
 */
export const useProjectScopeAssistantSwitch = projectSwitch => {
    const enabled = projectSwitch?.scope === 'project' && !!projectSwitch?.activeProjectId
    const allProjectsGroups = useAllProjectsAssistantGroups({ enabled })
    const switchToProjectWithAssistant = useSwitchToProjectWithAssistant()
    const switchToAllProjects = useSwitchToAllProjects()
    const defaultProjectId = useSelector(state => state.loggedUser?.defaultProjectId)
    const defaultAssistantId = useSelector(state => state.defaultAssistant?.uid || null)

    const projectId = projectSwitch?.activeProjectId || null
    const projectGroups = projectSwitch?.groups
    const selectInProject = projectSwitch?.onSelect

    const groups = useMemo(
        () =>
            enabled ? buildProjectScopeAssistantGroups({ projectId, projectGroups, allProjectsGroups }) : EMPTY_ARRAY,
        [enabled, projectId, projectGroups, allProjectsGroups]
    )

    const onSelect = useCallback(
        option => {
            if (!option) return
            // AT-3093 follow-up (decided with the product owner): the default project's default
            // assistant is the All Projects line's assistant, so choosing it returns to All
            // Projects instead of opening the default project, also from inside the default
            // project. Its "From your default project" entry in another project stays in place.
            if (isAllProjectsAssistantOption(option, defaultProjectId, defaultAssistantId)) {
                switchToAllProjects()
                return
            }
            if (option.projectId === projectId) {
                selectInProject?.(option)
                return
            }
            switchToProjectWithAssistant(option)
        },
        [
            projectId,
            selectInProject,
            switchToProjectWithAssistant,
            switchToAllProjects,
            defaultProjectId,
            defaultAssistantId,
        ]
    )

    return useMemo(() => {
        if (!enabled) return projectSwitch
        return { ...projectSwitch, groups, grouped: true, onSelect }
    }, [enabled, projectSwitch, groups, onSelect])
}
