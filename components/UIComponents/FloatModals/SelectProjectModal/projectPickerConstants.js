// Sentinel id for the "All projects" row in project pickers. Lives in its own
// module so ProjectListModal, AllProjectItem and SelectProjectModalInSearch can
// all import it without forming a cycle (SelectProjectModalInSearch renders
// ProjectListModal, which renders AllProjectItem).
export const ALL_PROJECTS_OPTION = 'ALL_PROJECTS'
