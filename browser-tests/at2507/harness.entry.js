/**
 * AT-2507 browser harness — the goal flourish's whole chain, actually painting.
 *
 * Renders the REAL `GoalCompletedFlourish` inside a box that reproduces the goal card
 * (`GoalItemPresentation`'s `container` + `borderInside`: min-height 40, border radius 4),
 * driven by the REAL `useGoalCompletedFlourish` and triggered by the REAL
 * `publishGoalTaskCompletion` — i.e. the same call the task row makes from
 * `beginCompletionMotion`. Nothing between the tick and the paint is stubbed.
 *
 * Jest can answer none of it: `__mocks__/react-native.js` replaces `Animated.timing` with a
 * no-op `{start}` stub, so no jest test can watch this advance a single pixel, and jsdom
 * computes no layout at all. Both are exactly what is under test here.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { StyleSheet, View } from 'react-native'

import GoalCompletedFlourish from '../../components/GoalsView/GoalCompletedFlourish'
import useGoalCompletedFlourish from '../../components/TaskListView/OpenTasksView/useGoalCompletedFlourish'
import { publishGoalTaskCompletion } from '../../components/TaskListView/OpenTasksView/goalCompletionSignal'

const PROJECT = 'project-a'
const GOAL = 'goal-1'
const ACCENT = '#6C63FF'

// `GoalItemPresentation`'s own box, so the overlay's absolute fill and its `borderRadius: 4` are
// measured against the card it actually ships against.
const cardStyles = StyleSheet.create({
    globalContainer: { paddingVertical: 4 },
    container: { minHeight: 40 },
    // Absolute, exactly as the row draws it — otherwise the border box stacks with the content and
    // the card measures twice its real height, which would quietly weaken every geometry check.
    border: { position: 'absolute', left: 0, top: 0, minHeight: 40, width: '100%', height: '100%' },
    borderInside: { height: '100%', minHeight: 40, borderRadius: 4, borderColor: '#DDD', borderWidth: 1 },
    content: { minHeight: 40, paddingLeft: 8, paddingTop: 10 },
})

function GoalRow({ taskList }) {
    const completedRunId = useGoalCompletedFlourish({
        projectId: PROJECT,
        goalId: GOAL,
        taskList,
        enabled: true,
    })
    window.__runId = completedRunId
    return (
        <View style={cardStyles.globalContainer}>
            <View style={cardStyles.container} nativeID="goal-card">
                <View style={cardStyles.border}>
                    <View style={cardStyles.borderInside} />
                </View>
                <View style={cardStyles.content} />
                <GoalCompletedFlourish completedRunId={completedRunId} accentColor={ACCENT} />
            </View>
        </View>
    )
}

function App() {
    const [taskList, setTaskList] = React.useState([{ id: 't1' }, { id: 't2' }])
    window.__setTaskList = setTaskList
    return (
        <View style={{ width: 620, backgroundColor: 'white', padding: 12 }}>
            <GoalRow taskList={taskList} />
        </View>
    )
}

/** Exactly what `TaskPresentation` publishes when a task row starts a genuine completion. */
window.__completeTask = taskId => publishGoalTaskCompletion({ projectId: PROJECT, goalId: GOAL, taskId })

/**
 * What the user would actually see, per layer — PAINTED geometry (`getBoundingClientRect` resolves
 * transforms) and computed opacity, never the `Animated.Value` behind them. That distinction is the
 * whole point of this harness: jest can read those values and still be looking at an animation that
 * never moves a pixel.
 */
const rect = testId => {
    const node = document.querySelector(`[data-testid="${testId}"]`)
    return node ? { node, box: node.getBoundingClientRect(), style: getComputedStyle(node) } : null
}

window.__measure = () => {
    const overlay = rect('goal-completed-flourish')
    if (!overlay) return { present: false }
    const wash = rect('goal-completed-flourish-wash')
    const bar = rect('goal-completed-flourish-bar')
    const card = document.querySelector('[data-nativeid="goal-card"]') || document.getElementById('goal-card')
    return {
        present: true,
        overlay: {
            top: Math.round(overlay.box.top),
            height: Math.round(overlay.box.height),
            width: Math.round(overlay.box.width),
        },
        cardWidth: card ? Math.round(card.getBoundingClientRect().width) : null,
        overlayOpacity: Number(overlay.style.opacity),
        washWidth: wash ? Math.round(wash.box.width) : null,
        washOpacity: wash ? Number(Number(wash.style.opacity).toFixed(3)) : null,
        washColor: wash ? wash.style.backgroundColor : null,
        // Draws with the fill (width) and thickens once for the breath (height).
        barWidth: bar ? Math.round(bar.box.width) : null,
        barHeight: bar ? Number(bar.box.height.toFixed(2)) : null,
        barColor: bar ? bar.style.backgroundColor : null,
        barLeft: bar ? Math.round(bar.box.left - overlay.box.left) : null,
    }
}

createRoot(document.getElementById('root')).render(<App />)
window.__ready = true
