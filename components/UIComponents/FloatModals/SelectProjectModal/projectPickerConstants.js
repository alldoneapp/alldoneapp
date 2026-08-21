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

export const isAutomaticProjectOption = projectId => projectId === AUTOMATIC_PROJECT_OPTION
