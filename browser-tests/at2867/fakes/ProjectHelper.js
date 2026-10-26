// Stand-in for the real ProjectHelper, whose module graph pulls in the whole redux store.
// The project line only asks it for the project's marker colour.
const ProjectHelper = {
    getProjectColorById: projectId => (projectId === 'task-project' ? '#E0533D' : '#2F80ED'),
}
export default ProjectHelper
