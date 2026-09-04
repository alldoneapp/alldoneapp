/**
 * AT-2507 browser harness — a goal section's graceful departure, actually painting.
 *
 * Drives the REAL `useGoalSectionExit` (which decides a goal is leaving and holds it) and the REAL
 * `useGoalSectionExitMotion` (which draws the departure), triggered by the REAL
 * `publishGoalTaskCompletion` — the same call `TaskPresentation` makes from
 * `beginCompletionMotion`. Nothing between the tick and the paint is stubbed.
 *
 * The board reproduces the two things the effect is measured against: a goal section shaped like
 * `ParentGoalSection`'s block (a goal row plus its task rows), and a SIBLING BLOCK BELOW IT, which
 * is how "the gap closes gracefully" becomes observable at all — the whole point of the collapse is
 * that the content underneath is pulled up rather than jumping.
 *
 * Jest can answer none of it: `__mocks__/react-native.js` replaces `Animated.timing` with a no-op
 * `{start}` stub, so no jest test can watch this advance a pixel, and jsdom computes no layout, so
 * the section is never measured and the collapse has no height to collapse from.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Animated, StyleSheet, View } from 'react-native'

import useGoalSectionExit from '../../components/TaskListView/OpenTasksView/useGoalSectionExit'
import useGoalSectionExitMotion from '../../components/TaskListView/OpenTasksView/goalSectionExitMotion'
import { publishGoalTaskCompletion } from '../../components/TaskListView/OpenTasksView/goalCompletionSignal'

const PROJECT = 'project-a'
const GOAL = 'goal-1'

const styles = StyleSheet.create({
    board: { width: 640, backgroundColor: 'white', padding: 12 },
    section: { marginBottom: 32 },
    goalRow: { minHeight: 40, borderRadius: 4, borderWidth: 1, borderColor: '#DDD', paddingLeft: 8, paddingTop: 10 },
    addTask: { height: 32 },
    taskRow: { height: 34, paddingLeft: 8 },
    below: { height: 60, backgroundColor: '#F3F3F3' },
})

function GoalSection({ goalId, tasks, exitRunId }) {
    const { onSectionLayout, sectionStyle } = useGoalSectionExitMotion(exitRunId)
    return (
        <Animated.View nativeID={`section-${goalId}`} onLayout={onSectionLayout} style={[styles.section, sectionStyle]}>
            <View style={styles.goalRow} />
            <View style={styles.addTask} />
            {tasks.map(task => (
                <View key={task.id} style={styles.taskRow} />
            ))}
        </Animated.View>
    )
}

function Board() {
    const [mainTasks, setMainTasks] = React.useState([[GOAL, [{ id: 't1' }, { id: 't2' }]]])
    const [emptyGoals, setEmptyGoals] = React.useState([])
    const { mainTasksWithExits, exitRunIdByGoalId } = useGoalSectionExit({
        projectId: PROJECT,
        mainTasks,
        emptyGoals,
        enabled: true,
    })

    window.__setMainTasks = setMainTasks
    window.__setEmptyGoals = setEmptyGoals
    // What the board is actually rendering, i.e. whether the hold is keeping the section alive.
    window.__sections = mainTasksWithExits.map(group => group[0])
    window.__exits = { ...exitRunIdByGoalId }

    return (
        <View style={styles.board}>
            {mainTasksWithExits.map(([goalId, tasks]) => (
                <GoalSection key={goalId} goalId={goalId} tasks={tasks} exitRunId={exitRunIdByGoalId[goalId] || 0} />
            ))}
            {/* The next thing down the board. Its `top` is how the collapse is measured. */}
            <View nativeID="below" style={styles.below} />
        </View>
    )
}

/** Exactly what `TaskPresentation` publishes when a task row starts a genuine completion. */
window.__completeTask = taskId => publishGoalTaskCompletion({ projectId: PROJECT, goalId: GOAL, taskId })
/** The snapshot landing: the goal's bucket is gone from the day's main tasks. */
window.__dropSection = () => window.__setMainTasks([])
/** The other fork: the goal is still active today, so it comes back as an empty goal instead. */
window.__moveToEmptyGoals = () => {
    window.__setMainTasks([])
    window.__setEmptyGoals([{ id: GOAL }])
}

/**
 * What the user would actually see — PAINTED geometry (`getBoundingClientRect` resolves transforms)
 * and computed opacity, never the `Animated.Value` behind them. That distinction is the whole point
 * of this harness: jest can read those values and still be looking at an animation that never moves
 * a pixel.
 */
const nodeOf = id => document.querySelector(`[data-nativeid="${id}"]`) || document.getElementById(id)

window.__measure = () => {
    const section = nodeOf(`section-${GOAL}`)
    const below = nodeOf('below')
    return {
        present: !!section,
        height: section ? Number(section.getBoundingClientRect().height.toFixed(1)) : null,
        opacity: section ? Number(Number(getComputedStyle(section).opacity).toFixed(3)) : null,
        // The layout underneath. This is what "the gap closes" means, and it is invisible from
        // inside the section itself.
        belowTop: below ? Math.round(below.getBoundingClientRect().top) : null,
    }
}

createRoot(document.getElementById('root')).render(<Board />)
window.__ready = true
