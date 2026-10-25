/**
 * AT-2430 — what the assistant line's switch control is allowed to switch to.
 *
 * Pure functions over explicit inputs, deliberately importing nothing but `translate`: the
 * option list is the part worth unit-testing, and `assistantsHelper.js` (the obvious place to
 * put it) drags in NavigationService, the project data loader and therefore the firestore
 * client through its transitive imports.
 *
 * ONE PROJECT'S OPTIONS are exactly what the existing "Select assistant" picker already shows
 * (`ChangeAssistantModal/AssistantsArea`): the global assistants enabled for the project, then
 * the project's own assistants, then — only when this is not the user's default project and it
 * is not already in the list — the default project's assistant as a labelled entry at the end.
 * Keeping that order identical is the point: the switch control and the assignment picker are
 * two views of the same set, and a user who has learned one should recognise the other.
 *
 * ALL PROJECTS' OPTIONS are those same per-project lists, GROUPED BY PROJECT and never
 * flattened. On the reporting account this is 33 assistants over 14 projects in which the same
 * display name is reused across projects as separate assistant documents — "Marty Marketing"
 * exists five times, "Derek Designer" three. A flat list is therefore not merely long, it is
 * ambiguous: five identical rows, and the only thing distinguishing them is the project. The
 * group header carries that information once per project instead of repeating it on every row.
 *
 * The default-project entry is deliberately NOT added per group in the all-projects list. It
 * would repeat the default assistant under all fourteen headers while its real row already sits
 * in the default project's own group.
 */

import { translate } from '../../../i18n/TranslationService'

/** A project with no assistants of its own contributes no group at all. */
const hasUid = assistant => !!assistant && !!assistant.uid

const toOption = (project, assistant, isDefaultProjectAssistant = false) => ({
    // Unique per (project, assistant): the same global assistant can legitimately be offered
    // under several projects, and those are different choices — they activate different projects.
    key: `${project.id}:${assistant.uid}`,
    assistantId: assistant.uid,
    projectId: project.id,
    projectName: project.name || '',
    isDefaultProjectAssistant,
    assistant: isDefaultProjectAssistant
        ? // Same treatment `AssistantsArea` gives this entry: the row explains where the
          // assistant comes from instead of showing its own description.
          { ...assistant, description: translate('From your default project') }
        : assistant,
})

/**
 * The assistants selectable while project `project` is the active one.
 *
 * @param {object}   project                        the project the options belong to
 * @param {object[]} projectAssistants              `state.projectAssistants[project.id]`
 * @param {object[]} globalAssistants               `state.globalAssistants`
 * @param {string}   defaultProjectId               `loggedUser.defaultProjectId`
 * @param {object}   defaultAssistant               `state.defaultAssistant`
 * @param {boolean}  includeDefaultProjectAssistant append the default-project entry (see header)
 */
export const buildProjectAssistantOptions = ({
    project,
    projectAssistants = [],
    globalAssistants = [],
    defaultProjectId = '',
    defaultAssistant = null,
    includeDefaultProjectAssistant = true,
} = {}) => {
    if (!project || !project.id) return []

    const globalAssistantsInProject = globalAssistants.filter(
        assistant => hasUid(assistant) && project.globalAssistantIds?.includes(assistant.uid)
    )

    const options = []
    const seen = new Set()

    // Order copied from AssistantsArea: global assistants first, then the project's own.
    ;[...globalAssistantsInProject, ...projectAssistants].forEach(assistant => {
        if (!hasUid(assistant) || seen.has(assistant.uid)) return
        seen.add(assistant.uid)
        options.push(toOption(project, assistant))
    })

    const isNotDefaultProject = !!defaultProjectId && project.id !== defaultProjectId
    if (
        includeDefaultProjectAssistant &&
        isNotDefaultProject &&
        hasUid(defaultAssistant) &&
        !seen.has(defaultAssistant.uid)
    ) {
        options.push(toOption(project, defaultAssistant, true))
    }

    return options
}

/**
 * Projects ordered for the all-projects popup: the user's default project first — it is where
 * the assistant currently answering on the home page lives — then the caller's own order, which
 * is the sidebar order the user already reads the app in.
 */
export const orderProjectsForAssistantSwitch = (projects = [], defaultProjectId = '') => {
    const usable = projects.filter(project => !!project && !!project.id)
    const defaultProject = usable.find(project => project.id === defaultProjectId)
    return defaultProject ? [defaultProject, ...usable.filter(project => project !== defaultProject)] : usable
}

/**
 * One group per project that actually has assistants. Empty projects are dropped rather than
 * rendered as an empty header — four of the reporting account's fourteen active projects have
 * no assistant at all.
 */
export const buildAllProjectsAssistantGroups = ({
    projects = [],
    assistantsByProject = {},
    globalAssistants = [],
    defaultProjectId = '',
} = {}) => {
    return orderProjectsForAssistantSwitch(projects, defaultProjectId)
        .map(project => ({
            projectId: project.id,
            projectName: project.name || '',
            isDefaultProject: project.id === defaultProjectId,
            options: buildProjectAssistantOptions({
                project,
                projectAssistants: assistantsByProject[project.id] || [],
                globalAssistants,
                defaultProjectId,
                includeDefaultProjectAssistant: false,
            }),
        }))
        .filter(group => group.options.length > 0)
}

/** One group, for the single-project case, so both scopes render through the same component. */
export const buildSingleAssistantGroup = (project, options) =>
    options.length > 0
        ? [
              {
                  projectId: project?.id || '',
                  projectName: project?.name || '',
                  isDefaultProject: false,
                  options,
              },
          ]
        : []

export const flattenAssistantGroups = (groups = []) => groups.reduce((all, group) => all.concat(group.options), [])

export const countAssistantOptions = (groups = []) => groups.reduce((total, group) => total + group.options.length, 0)

export const findAssistantOption = (groups = [], projectId, assistantId) =>
    flattenAssistantGroups(groups).find(
        option => option.assistantId === assistantId && (!projectId || option.projectId === projectId)
    ) || null

/**
 * The option a two-option control switches TO. With exactly two options the control is a direct
 * toggle rather than a popup, which is what keeps today's one-click in-project behaviour intact.
 * An active option that is not in the list (a stale selection, an assistant deleted meanwhile)
 * falls back to the first option so the button can never become a no-op.
 */
export const getToggleTargetOption = (groups = [], activeProjectId, activeAssistantId) => {
    const options = flattenAssistantGroups(groups)
    if (options.length === 0) return null

    const other = options.find(
        option =>
            option.assistantId !== activeAssistantId ||
            (!!activeProjectId && !!option.projectId && option.projectId !== activeProjectId)
    )
    return other || options[0]
}
