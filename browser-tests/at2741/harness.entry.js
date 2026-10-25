import 'setimmediate'
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import store from '../../redux/store'
import { initFirebase } from '../../utils/backends/firestore'
import Backend from '../../utils/BackendBridge'
import DescriptionField from '../../components/TaskDetailedView/Properties/DescriptionField'
import { quillTextInputRefs } from '../../components/Feeds/CommentsTextInput/CustomTextInput3'

const user = {
    uid: 'browser-user',
    displayName: 'Test User',
    email: 'test@example.test',
    defaultProjectId: 'browser-project',
    activeProjects: ['browser-project'],
    inactiveProjects: [],
    projectIds: ['browser-project'],
    isAnonymous: false,
    gold: 1000,
    premium: { status: 'premium' },
    monthlyTraffic: 0,
    language: 'en',
}
store.dispatch({ type: 'Init anonymous sesion', loggedUser: user, currentUser: user })
store.dispatch({
    type: 'Set project initial data',
    project: {
        id: 'browser-project',
        name: 'Browser fixture',
        color: '#fff',
        isShared: false,
        parentTemplateId: null,
        monthlyTraffic: 0,
    },
    users: [user],
    workstreams: [],
    contacts: [],
    assistants: [],
})
window.__writes = []
window.__uploads = []
window.__failWrite = false
window.__failUpload = false
Backend.storeAttachment = async (_projectId, file) => {
    window.__uploads.push(file.name)
    await new Promise(resolve => setTimeout(resolve, 150))
    if (window.__failUpload) throw new Error('simulated upload failure')
    return `${window.location.origin}/image.png?upload=${window.__uploads.length}`
}
window.__editor = () =>
    Object.values(quillTextInputRefs)
        .find(ref => ref?.getEditor()?.root?.isConnected)
        ?.getEditor()

function Harness() {
    const [description, setDescription] = useState('Existing description')
    const [visible, setVisible] = useState(true)
    window.__setDescription = setDescription
    window.__setVisible = setVisible
    return (
        <div style={{ maxWidth: 760, margin: '32px auto', padding: 16 }}>
            <h2>AT-2741 · Description autosave</h2>
            {visible && (
                <DescriptionField
                    projectId="browser-project"
                    object={{ id: 'browser-task', name: 'Example task', description }}
                    objectType="task"
                    disabled={false}
                />
            )}
            <button id="outside">Outside the description</button>
        </div>
    )
}
const root = document.createElement('div')
document.body.appendChild(root)
initFirebase(() => {})
    .catch(() => {})
    .then(() =>
        createRoot(root).render(
            <Provider store={store}>
                <Harness />
            </Provider>
        )
    )
