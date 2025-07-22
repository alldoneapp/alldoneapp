import store from '../../redux/store'
import { setSelectedTypeOfProject, setSharedData, switchProject } from '../../redux/actions'
import URLTrigger from '../../URLSystem/URLTrigger'
import { getInitialProjectData, watchProjectData } from './initialLoadHelper'
import { PROJECT_TYPE_SHARED } from '../../components/SettingsView/ProjectsSettings/ProjectsSettings'

export async function loadInitialDataForShared(projectId, navigation, URL) {
    const { loggedUserProjectsMap } = store.getState()
    if (loggedUserProjectsMap[projectId]) {
        const projectIndex = loggedUserProjectsMap[projectId].index
        store.dispatch([switchProject(projectIndex), setSelectedTypeOfProject(PROJECT_TYPE_SHARED)])
    } else {
        const { project, users, workstreams, contacts, assistants } = await getInitialProjectData(projectId)
        store.dispatch(setSharedData(project, users, workstreams, contacts, assistants))
        watchProjectData(projectId, false, false)
    }
    URLTrigger.directProcessUrl(navigation, URL)
}
