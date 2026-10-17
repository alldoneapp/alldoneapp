import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { createStore } from 'redux'
import MentionsGoalsGrouped from '../../components/UIComponents/FloatModals/TaskParentGoalModal/MentionsGoalsGrouped'
import MentionsContactsGrouped from '../../components/Feeds/CommentsTextInput/MentionsModal/MentionsContactsGrouped'
import MentionsItemsGrouped from '../../components/Feeds/CommentsTextInput/MentionsModal/MentionsItemsGrouped'

const projects = {
    current: { id: 'current', name: 'Alldone Product', color: '#7c66ff', index: 0 },
    other: { id: 'other', name: 'Weiteres Projekt', color: '#00b88d', index: 1 },
}
const store = createStore(() => ({ loggedUserProjectsMap: projects }))
const rows = ['Anna Alldone – Mac menubar app', 'Release on AppStores (iOS and Android & Mac?)'].map((name, index) => ({
    id: `result-${index}`,
    uid: `result-${index}`,
    name,
    extendedName: name,
    extendedTitle: name,
    displayName: name,
    userId: 'me',
    projectId: index ? 'other' : 'current',
    progress: 50,
    assigneesIds: [],
}))

function Harness() {
    const [tab, setTab] = useState('Zielauswahl')
    const [query, setQuery] = useState('mac')
    const [selected, setSelected] = useState('')
    const refs = useRef({})
    const items = rows.filter(row => row.name.toLowerCase().includes(query.toLowerCase()))
    const onSelect = (item, _tab, projectId) => setSelected(`${item.id}:${projectId}`)
    const props = {
        currentProjectId: 'current',
        items,
        goals: items,
        contacts: items,
        selectItemToMention: onSelect,
        selectUserToMention: onSelect,
        itemsComponentsRefs: refs,
        usersComponentsRefs: refs,
        activeItemIndex: 1,
        activeUserIndex: 1,
        currentlyAssignedGoal: rows[0],
        activeTab: 2,
    }
    return (
        <main style={{ width: 'min(432px, calc(100% - 32px))', margin: '24px auto', color: 'white' }}>
            <nav style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                {['Zielauswahl', '@Notizen', '@Kontakte'].map(name => (
                    <button key={name} onClick={() => setTab(name)}>
                        {name}
                    </button>
                ))}
            </nav>
            <section data-testid="popup" style={{ background: '#0c163f', padding: 16, borderRadius: 4 }}>
                <h2 style={{ margin: '0 0 16px' }}>{tab}</h2>
                <input
                    aria-label="Suche"
                    value={query}
                    onChange={event => setQuery(event.target.value)}
                    style={{
                        boxSizing: 'border-box',
                        width: '100%',
                        padding: 12,
                        background: 'transparent',
                        color: 'white',
                        border: '1px solid #a7b2ca',
                        borderRadius: 4,
                    }}
                />
                {tab === 'Zielauswahl' ? (
                    <MentionsGoalsGrouped {...props} />
                ) : tab === '@Kontakte' ? (
                    <MentionsContactsGrouped {...props} />
                ) : (
                    <MentionsItemsGrouped {...props} />
                )}
            </section>
            <output aria-label="Auswahl">{selected}</output>
        </main>
    )
}
createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <Harness />
    </Provider>
)
