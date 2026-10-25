import 'setimmediate'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { Text } from 'react-native'
import moment from 'moment'

import GoalItemPresentation from '../../components/GoalsView/GoalItemPresentation'
import { TaskHierarchyGroup } from '../../components/TaskListView/TaskHierarchy'
import { FEED_PUBLIC_FOR_ALL } from '../../components/Feeds/Utils/FeedsConstants'
import { getResponsiveLayoutState } from '../../utils/responsiveLayout'
import store from './store'

window.__actions = []
window.__navigation = []
window.__edits = 0
const params = new URLSearchParams(location.search)
const long = params.has('long')
const done = params.has('done')
const goal = {
    id: 'g1',
    extendedName: long
        ? 'Next Update: Sehr langer Goal-Titel zur internationalen strategischen Produktentwicklung'
        : 'Next Update',
    ownerId: 'u1',
    assigneesIds: long && !done ? ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8'] : ['u1'],
    assigneesCapacity: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`u${i + 1}`, 'CAPACITY_NONE'])),
    assigneesReminderDate: {
        u1: moment()
            .startOf('day')
            .add(params.has('reminder') ? 1 : 0, 'days')
            .valueOf(),
    },
    progress: 90,
    dynamicProgress: 90,
    hasStar: '#FFFFFF',
    progressByDoneMilestone: { m1: { progress: 90, doneDate: Date.now() } },
    completionMilestoneDate: params.has('backlog') ? Number.MAX_SAFE_INTEGER : moment('2026-10-31').valueOf(),
    startingMilestoneDate: moment('2026-10-01').valueOf(),
    dateByDoneMilestone: {},
    parentDoneMilestoneIds: [],
    timesPostponed: 196,
    description: '',
    isPublicFor: [FEED_PUBLIC_FOR_ALL],
    focusAreaId: long ? 'long' : null,
    scheduleMode: 'dynamic',
    inDoneMilestone: done,
}
window.addEventListener('resize', () => {
    store.dispatch({
        type: 'viewport',
        layout: getResponsiveLayoutState({ width: window.innerWidth, sidebarExpanded: true }),
    })
})
const host = document.createElement('div')
document.body.appendChild(host)
createRoot(host).render(
    <Provider store={store}>
        <div id="board" style={{ margin: '48px 24px', maxWidth: 1100 }}>
            <TaskHierarchyGroup>
                <GoalItemPresentation
                    goal={goal}
                    projectId="p1"
                    inParentGoal
                    parentGoaltasks={[{ id: 't1' }]}
                    milestoneId={done ? 'm1' : undefined}
                    inDoneMilestone={done}
                    activeDragGoalMode={params.has('organize')}
                    onPress={() => window.__edits++}
                />
                <div id="following-task" style={{ padding: '12px 32px' }}>
                    <Text>Neue Aufgabe hinzufügen</Text>
                </div>
            </TaskHierarchyGroup>
        </div>
    </Provider>
)
