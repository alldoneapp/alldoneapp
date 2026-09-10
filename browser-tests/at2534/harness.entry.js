import React from 'react'
import { createRoot } from 'react-dom/client'
import { Animated, StyleSheet, View } from 'react-native'

import GeneralTaskSectionEntry from '../../components/TaskListView/OpenTasksView/GeneralTaskSectionEntry'
import useGoalSectionExit from '../../components/TaskListView/OpenTasksView/useGoalSectionExit'
import useGoalSectionExitMotion from '../../components/TaskListView/OpenTasksView/goalSectionExitMotion'
import { publishGoalTaskCompletion } from '../../components/TaskListView/OpenTasksView/goalCompletionSignal'

const PROJECT = 'project-a'
const GOAL = 'goal-1'

const styles = StyleSheet.create({
    board: { width: 640, backgroundColor: '#FFFFFF', padding: 12 },
    goal: { height: 132, marginBottom: 0, borderRadius: 8, backgroundColor: '#F2F4F7' },
    addTask: { height: 42, borderRadius: 4, backgroundColor: '#E7EDF4' },
    below: { height: 60, backgroundColor: '#F7F7F7' },
})

function GoalSection({ exitRunId }) {
    const { onSectionLayout, sectionStyle } = useGoalSectionExitMotion(exitRunId)
    return <Animated.View nativeID="goal" onLayout={onSectionLayout} style={[styles.goal, sectionStyle]} />
}

function Board() {
    const [mainTasks, setMainTasks] = React.useState([[GOAL, [{ id: 'task-1' }]]])
    const { mainTasksWithExits, exitRunIdByGoalId } = useGoalSectionExit({
        projectId: PROJECT,
        mainTasks,
        emptyGoals: [],
        enabled: true,
    })

    const onlyDepartingGoalsRemain =
        mainTasksWithExits.length > 0 && mainTasksWithExits.every(([goalId]) => !!exitRunIdByGoalId[goalId])
    const entryRunId = onlyDepartingGoalsRemain
        ? Math.max(...mainTasksWithExits.map(([goalId]) => exitRunIdByGoalId[goalId]))
        : 0
    const showGeneralTask = mainTasksWithExits.length === 0 || onlyDepartingGoalsRemain

    window.__completeAndDrop = () => {
        publishGoalTaskCompletion({ projectId: PROJECT, goalId: GOAL, taskId: 'task-1' })
        setMainTasks([])
    }

    return (
        <View style={styles.board}>
            {mainTasksWithExits.map(([goalId]) => (
                <GoalSection key={goalId} exitRunId={exitRunIdByGoalId[goalId] || 0} />
            ))}
            {showGeneralTask && (
                <GeneralTaskSectionEntry entryRunId={entryRunId}>
                    <View nativeID="general-add-task" style={styles.addTask} />
                </GeneralTaskSectionEntry>
            )}
            <View nativeID="below" style={styles.below} />
        </View>
    )
}

const nodeOf = id => document.querySelector(`[data-nativeid="${id}"]`) || document.getElementById(id)
window.__measure = () => {
    const goal = nodeOf('goal')
    const entry = document.querySelector('[data-testid="general-task-section-entry"]')
    const entryContent = entry?.firstElementChild
    const below = nodeOf('below')
    return {
        goalPresent: !!goal,
        goalHeight: goal ? Number(goal.getBoundingClientRect().height.toFixed(1)) : null,
        goalOpacity: goal ? Number(Number(getComputedStyle(goal).opacity).toFixed(3)) : null,
        entryPresent: !!entry,
        entryHeight: entry ? Number(entry.getBoundingClientRect().height.toFixed(1)) : null,
        entryOpacity: entryContent ? Number(Number(getComputedStyle(entryContent).opacity).toFixed(3)) : null,
        belowTop: below ? Number(below.getBoundingClientRect().top.toFixed(1)) : null,
    }
}

createRoot(document.getElementById('root')).render(<Board />)
window.__ready = true
