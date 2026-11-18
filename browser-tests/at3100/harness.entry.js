import 'setimmediate'
import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'

import store from '../../redux/store'
import AssistantSwitchControl from '../../components/MyDayView/AssistantLine/AssistantSwitchControl'
import { installEscapeStack } from '../../utils/escapeStack'

// The screenshot's account: four projects, eleven assistants — enough to scroll the popup.
const PROJECTS = [
    ['p-private', 'Privat', ['Anna Alldone', 'Ricky Real Estate', 'Connor Coach', 'Judy Job', 'Sarah Songwriter']],
    ['p-jtl', 'JTL Software - Project Juno', ['JTL Assistant']],
    ['p-consulting', 'Alldone Consulting', ['Alldone Consulting COO', 'Lenny LinkedIn', 'Marty Marketing']],
    ['p-team', 'Alldone Team', ['Paul Product Manager', 'Marty Marketing']],
]
const groups = PROJECTS.map(([projectId, projectName, names]) => ({
    projectId,
    projectName,
    options: names.map((displayName, index) => {
        const uid = `${projectId}-a${index}`
        return {
            key: `${projectId}:${uid}`,
            assistantId: uid,
            projectId,
            projectName,
            isDefaultProjectAssistant: false,
            assistant: { uid, displayName, description: index === 0 ? 'Your personal assistant' : '' },
        }
    }),
}))

function Harness() {
    const [active, setActive] = useState({ projectId: 'p-private', assistantId: 'p-private-a0' })
    window.__active = active
    return (
        <div style={{ padding: 40 }}>
            <AssistantSwitchControl
                groups={groups}
                grouped={true}
                activeProjectId={active.projectId}
                activeAssistantId={active.assistantId}
                onSelect={option => setActive({ projectId: option.projectId, assistantId: option.assistantId })}
                label={'Anna Alldone'}
            />
        </div>
    )
}

installEscapeStack()
createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <Harness />
    </Provider>
)
window.__ready = true
