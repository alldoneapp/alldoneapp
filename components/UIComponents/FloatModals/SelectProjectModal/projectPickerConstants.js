// Sentinel id for the "All projects" row in project pickers. Lives in its own
// module so ProjectListModal, AllProjectItem and SelectProjectModalInSearch can
// all import it without forming a cycle (SelectProjectModalInSearch renders
// ProjectListModal, which renders AllProjectItem).
export const ALL_PROJECTS_OPTION = 'ALL_PROJECTS'

// Sentinel id for the "Automatic" row in the add-task project picker (AT-2306).
// Selecting it does NOT mean "no project" — a task always lives in exactly one
// project, so the task is created in the user's default project right away and
// the server-side router (functions/Tasks/taskProjectRouting.js) moves it to the
// best-fitting project afterwards. Kept next to ALL_PROJECTS_OPTION because both
// are leading rows of the same shared picker and must never collide with a real
// Firebase project id.
export const AUTOMATIC_PROJECT_OPTION = 'AUTOMATIC_PROJECT'

// Sentinel id for the "All archived" row of the search scope picker (AT-2390).
// The Archived tab needs its own leading row rather than reusing
// ALL_PROJECTS_OPTION: the two mean different scopes ("every active project" vs
// "every archived project"), they are simultaneously visible as the two tabs'
// leading rows, and the scope chip has to be able to tell them apart.
export const ALL_ARCHIVED_PROJECTS_OPTION = 'ALL_ARCHIVED_PROJECTS'

// i18n keys for the leading rows. The search scope picker renames its
// all-active row to "All active" (symmetric with "All archived", and accurate:
// it never covered archived projects); the "Switch project" pickers built on
// the same shared row keep "All projects".
export const ALL_PROJECTS_LABEL = 'All projects'
export const ALL_ACTIVE_SCOPE_LABEL = 'All active'
export const ALL_ARCHIVED_SCOPE_LABEL = 'All archived'

export const isAutomaticProjectOption = projectId => projectId === AUTOMATIC_PROJECT_OPTION

export const isAllArchivedProjectsOption = projectId => projectId === ALL_ARCHIVED_PROJECTS_OPTION

// The leading rows are sentinels, never real Firebase project ids — anything
// that resolves a scope to a concrete project list must exclude them.
export const isProjectPickerSentinel = projectId =>
    projectId === ALL_PROJECTS_OPTION ||
    projectId === AUTOMATIC_PROJECT_OPTION ||
    projectId === ALL_ARCHIVED_PROJECTS_OPTION
