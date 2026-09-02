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
import {
    hasCelebratedProjectEmptyInboxDay,
    markProjectEmptyInboxDayReached,
} from '../../components/TaskListView/OpenTasksView/projectEmptyInboxCelebrationMarker'

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
// Asked through the marker's own API rather than by inspecting localStorage keys, so the
// once-per-day assertion cannot silently pass on a renamed storage key.
window.__hasCelebrated = dayKey => hasCelebratedProjectEmptyInboxDay(USER, PROJECT, dayKey)

/**
 * What the user would actually see, per layer — PAINTED geometry (`getBoundingClientRect` resolves
 * transforms) and computed opacity, never the `Animated.Value` behind them. That distinction is the
 * whole point of this harness: jest can read the values and still be looking at an animation that
 * never advances a pixel.
 *
 * Every layer of the four-stage run is reported, because "the sweep animates" was already true of
 * the single-pass version — what has to be checked now is that each stage happens, in order, and
 * that nothing is left painted on the row afterwards.
 */
const rect = testId => {
    const node = document.querySelector(`[data-testid="${testId}"]`)
    return node ? { node, box: node.getBoundingClientRect(), style: getComputedStyle(node) } : null
}

window.__measure = () => {
    const overlay = rect('project-completed-sweep')
    if (!overlay) return { present: false }
    const wash = rect('project-completed-sweep-wash')
    const edge = rect('project-completed-sweep-edge')
    const shimmer = rect('project-completed-sweep-shimmer')
    const pulse = rect('project-completed-sweep-pulse')
    const accent = rect('project-completed-sweep-accent')
    const offsetIn = layer => (layer ? Math.round(layer.box.left - overlay.box.left) : null)
    return {
        present: true,
        overlay: { top: overlay.box.top, height: overlay.box.height, width: overlay.box.width },
        washWidth: wash ? Math.round(wash.box.width) : null,
        washOpacity: wash ? Number(wash.style.opacity) : null,
        washColor: wash ? wash.style.backgroundColor : null,
        edgePresent: !!edge,
        edgeLeft: offsetIn(edge),
        shimmerPresent: !!shimmer,
        shimmerLeft: offsetIn(shimmer),
        shimmerWidth: shimmer ? Math.round(shimmer.box.width) : null,
        // The breath: invisible (0) outside stage 3 by amplitude, never by unmounting.
        pulseOpacity: pulse ? Number(pulse.style.opacity) : null,
        // Draws with the fill (width) and thickens for the breath (height).
        accentWidth: accent ? Math.round(accent.box.width) : null,
        accentHeight: accent ? Number(accent.box.height.toFixed(2)) : null,
        accentOpacity: accent ? Number(accent.style.opacity) : null,
    }
}

createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <App />
    </Provider>
)
window.__ready = true
