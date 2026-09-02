/**
 * AT-2492 browser harness — the completed sweep's VISUAL chain.
 *
 * Renders the REAL `ProjectCompletedSweep` driven by the REAL `useProjectCompletedSweep`,
 * inside a row that reproduces `ProjectHeader`'s exact box (borderContainer + a 56px
 * container with paddingTop 25), against a real react-redux store.
 *
 * Jest cannot answer any of this: `__mocks__/react-native.js` replaces `Animated.timing`
 * with a no-op, and jsdom computes no layout, so `onLayout` never fires and the animation
 * never advances. Both of those are exactly the parts under test.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { StyleSheet, View } from 'react-native'
import { Provider } from 'react-redux'
import { legacy_createStore as createStore } from 'redux'

import ProjectCompletedSweep from '../../components/TaskListView/Header/ProjectCompletedSweep'
import useProjectCompletedSweep from '../../components/TaskListView/OpenTasksView/useProjectCompletedSweep'
import { markProjectEmptyInboxDayReached } from '../../components/TaskListView/OpenTasksView/projectEmptyInboxCelebrationMarker'

const USER = 'user-1'
const PROJECT = 'project-a'

const initialState = {
    sidebarNumbers: { [PROJECT]: { [USER]: 1 } },
    loggedUserProjectsMap: { [PROJECT]: { color: '#2F80ED', index: 0, id: PROJECT } },
}

const reducer = (state = initialState, action) => (action.type === 'SET' ? { ...state, ...action.payload } : state)
const store = createStore(reducer)

// Exactly ProjectHeader's own styles, so the overlay's `top: 20 / bottom: 1` inset is
// measured against the real box it ships against.
const headerStyles = StyleSheet.create({
    borderContainer: { borderBottomWidth: 1, borderBottomColor: '#E5E5E5' },
    container: {
        flex: 1,
        height: 56,
        minHeight: 56,
        maxHeight: 56,
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingTop: 25,
        paddingBottom: 6,
    },
})

function Row({ lineWouldLeave }) {
    const { celebrationRunId, holdProjectLine } = useProjectCompletedSweep({
        projectId: PROJECT,
        userId: USER,
        enabled: true,
        lineWouldLeave,
    })
    window.__runId = celebrationRunId
    window.__hold = holdProjectLine
    if (lineWouldLeave && !holdProjectLine) return null
    return (
        <View style={headerStyles.borderContainer} nativeID="header-row">
            <ProjectCompletedSweep runId={celebrationRunId} projectId={PROJECT} />
            <View style={headerStyles.container} />
        </View>
    )
}

function App() {
    const [lineWouldLeave, setLineWouldLeave] = React.useState(false)
    window.__setLineWouldLeave = setLineWouldLeave
    return (
        <View style={{ width: 900, backgroundColor: 'white' }}>
            <Row lineWouldLeave={lineWouldLeave} />
        </View>
    )
}

window.__setCount = count =>
    store.dispatch({ type: 'SET', payload: { sidebarNumbers: { [PROJECT]: { [USER]: count } } } })
window.__markReached = dayKey => markProjectEmptyInboxDayReached(USER, PROJECT, dayKey)

// What the user would actually see: the wash's painted width and its colour.
window.__measure = () => {
    const el = document.querySelector('[data-testid="project-completed-sweep"]')
    const w = document.querySelector('[data-testid="project-completed-sweep-wash"]')
    const e = document.querySelector('[data-testid="project-completed-sweep-edge"]')
    if (!el) return { present: false }
    const box = el.getBoundingClientRect()
    const washBox = w ? w.getBoundingClientRect() : null
    const cs = w ? getComputedStyle(w) : null
    return {
        present: true,
        overlay: { top: box.top, height: box.height, width: box.width },
        washWidth: washBox ? Math.round(washBox.width) : null,
        washOpacity: cs ? cs.opacity : null,
        washColor: cs ? cs.backgroundColor : null,
        washTransform: cs ? cs.transform : null,
        edgePresent: !!e,
        edgeLeft: e ? Math.round(e.getBoundingClientRect().left - box.left) : null,
    }
}

createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <App />
    </Provider>
)
window.__ready = true
