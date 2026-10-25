import 'setimmediate'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import 'quill/dist/quill.snow.css'

import store from '../../redux/store'
import AddTaskTag from '../../components/Tags/AddTaskTag'
import { installEscapeStack } from '../../utils/escapeStack'

const projectId = 'project-1'
const user = {
    uid: 'user-1',
    displayName: 'Test user',
    email: 'test@example.com',
    photoURL: '',
    defaultProjectId: projectId,
    activeProjects: [projectId],
    inactiveProjects: [],
    projectIds: [projectId],
    archivedProjectIds: [],
    templateProjectIds: [],
    guideProjectIds: [],
    realProjectIds: [projectId],
    realArchivedProjectIds: [],
    realGuideProjectIds: [],
    realTemplateProjectIds: [],
    workstreams: {},
    premium: { status: 'FREE' },
}
store.dispatch({ type: 'Init anonymous sesion', loggedUser: user, currentUser: user })
store.dispatch({
    type: 'Set project initial data',
    project: {
        id: projectId,
        name: 'Test project',
        color: '#0D55CF',
        isShared: false,
        parentTemplateId: null,
        sortIndexByUser: { [user.uid]: 0 },
    },
    users: [user],
    workstreams: [],
    contacts: [],
    assistants: [],
})
installEscapeStack()
createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <div style={{ padding: 100 }}>
            <AddTaskTag projectId={projectId} />
        </div>
    </Provider>
)
window.__ready = true
window.__taskCreationState = () => ({
    editors: store.getState().taskEditorCount,
    popups: store.getState().showFloatPopup,
})
