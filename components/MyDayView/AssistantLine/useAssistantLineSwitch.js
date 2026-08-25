import { useCallback, useMemo } from 'react'
import { shallowEqual, useDispatch, useSelector } from 'react-redux'

import { setAssistantLineAssistant } from '../../../redux/actions'
import useProjectData from '../../../hooks/useProjectData'
import { PROJECT_DATA_ASSISTANTS } from '../../../utils/InitialLoad/projectDataLoader'
import { buildProjectAssistantOptions, buildSingleAssistantGroup, findAssistantOption } from './assistantSwitchOptions'

const EMPTY_ARRAY = []

/**
 * AT-2430 — the assistant line inside one project: which assistant it speaks as, and what its
 * switch control can offer.
 *
 * This absorbs the ~20 lines of assistant resolution that OpenTasksByProject,
 * PendingTasksByProject and DoneTasksByProject each carried as an identical copy. Three copies
 * of a rule that now has a user-chosen override folded into it is three chances to diverge, and
 * the divergence would be invisible: those are three tabs of the same project, so a mismatch
 * shows up only as the assistant changing when you switch tabs.
 *
 * Deliberately free of `ProjectHelper` and the firestore client — this hook is mounted on every
 * project board, and `ProjectHelper` alone reaches react-native-gesture-handler through
 * ProjectsSettings. The all-projects half, which genuinely needs to enumerate projects, lives in
 * its own module for that reason.
 */
export const useProjectAssistantLine = project => {
    const dispatch = useDispatch()
    const projectId = project?.id
    const defaultProjectId = useSelector(state => state.loggedUser?.defaultProjectId)
    const defaultAssistant = useSelector(state => state.defaultAssistant)
    const defaultProject = useSelector(state => state.loggedUserProjectsMap?.[defaultProjectId])
    const projectAssistants = useSelector(state => state.projectAssistants?.[projectId] || EMPTY_ARRAY, shallowEqual)
    const globalAssistants = useSelector(state => state.globalAssistants || EMPTY_ARRAY, shallowEqual)
    // Read this project's key, never the whole map (AT-2336): the value is a string, so an
    // unrelated project's selection cannot re-render this board.
    const selectedAssistantId = useSelector(state =>
        projectId ? state.assistantLineSelection?.[projectId] || null : null
    )

    // AT-2386 left `projectAssistants` loaded per project on demand, and the switch has to list
    // the whole project, not just the assistant already resolved.
    useProjectData(projectId, PROJECT_DATA_ASSISTANTS)

    const isDefaultProject = !!projectId && projectId === defaultProjectId
    const defaultProjectAssistantId = defaultProject?.assistantId || defaultAssistant?.uid || ''
    const projectAssistantId = project?.assistantId || defaultProjectAssistantId
    const useSelectedProjectAssistantLine =
        isDefaultProject || (!!project?.assistantId && project.assistantId !== defaultProjectAssistantId)
    const baseAssistantId = useSelectedProjectAssistantLine ? projectAssistantId : defaultProjectAssistantId

    const options = useMemo(
        () =>
            buildProjectAssistantOptions({
                project,
                projectAssistants,
                globalAssistants,
                defaultProjectId,
                defaultAssistant,
            }),
        [project, projectAssistants, globalAssistants, defaultProjectId, defaultAssistant]
    )

    const groups = useMemo(() => buildSingleAssistantGroup(project, options), [project, options])

    // A selection is only honoured while it still resolves to a real option — an assistant that
    // was deleted, or moved out of this project, falls back instead of blanking the line.
    const activeOption = useMemo(
        () => (selectedAssistantId ? findAssistantOption(groups, projectId, selectedAssistantId) : null),
        [groups, projectId, selectedAssistantId]
    )

    const onSelect = useCallback(
        option => {
            if (!option || !projectId) return
            dispatch(setAssistantLineAssistant(projectId, option.assistantId))
        },
        [dispatch, projectId]
    )

    const assistantIdOverride = activeOption ? activeOption.assistantId : baseAssistantId
    // The default project's assistant answers out of the global conversation, wherever it is
    // used. That was the meaning of the old two-state toggle and it is preserved here.
    const defaultProjectAssistantActive = activeOption
        ? activeOption.isDefaultProjectAssistant
        : !useSelectedProjectAssistantLine

    const assistantSwitch = useMemo(
        () => ({
            groups,
            grouped: false,
            activeProjectId: projectId || null,
            activeAssistantId: assistantIdOverride,
            onSelect,
        }),
        [groups, projectId, assistantIdOverride, onSelect]
    )

    return {
        hasAssistantLine: !!project && !!assistantIdOverride,
        assistantLineProps: {
            showLastComment: true,
            useAssistantProjectContext: defaultProjectAssistantActive,
            useGlobalLatestComment: defaultProjectAssistantActive,
            projectOverride: project,
            assistantIdOverride,
            // Only an explicit choice may outrank `project.assistantId` inside
            // `getAssistantLineData`; without one the resolution is bit-for-bit what it was.
            preferAssistantIdOverride: !!activeOption,
            assistantSwitch,
        },
    }
}
