import store from '../../redux/store'
import { setSelectedTypeOfProject, setSharedData, switchProject } from '../../redux/actions'
import URLTrigger from '../../URLSystem/URLTrigger'
import { getInitialProjectData, watchProjectData } from './initialLoadHelper'
import { PROJECT_TYPE_SHARED } from '../../components/SettingsView/ProjectsSettings/ProjectsSettings'

// `publicLinkProject`: a note opened through its public link in a project the user cannot read
// (SharedHelper.createPublicNoteLinkProject). Nothing of the project is read or watched then.
export async function loadInitialDataForShared(projectId, navigation, URL, publicLinkProject = null) {
    const { loggedUserProjectsMap } = store.getState()
    if (loggedUserProjectsMap[projectId]) {
        const projectIndex = loggedUserProjectsMap[projectId].index
        store.dispatch([switchProject(projectIndex), setSelectedTypeOfProject(PROJECT_TYPE_SHARED)])
    } else if (publicLinkProject) {
        store.dispatch(setSharedData(publicLinkProject, [], [], [], []))
    } else {
        const { project, users, workstreams, contacts, assistants } = await getInitialProjectData(projectId)
        store.dispatch(setSharedData(project, users, workstreams, contacts, assistants))
        watchProjectData(projectId, false, false)
    }
    URLTrigger.directProcessUrl(navigation, URL)
}
