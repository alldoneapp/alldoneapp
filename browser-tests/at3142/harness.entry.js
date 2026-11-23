import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import moment from 'moment'

import DailyPlanEntry from '../../components/TaskListView/DailyPlan/DailyPlanEntry'
import store from './store'

// Synthetic data only. ?scenario=normal|overload|nocal, ?mobile for the phone layout.
const params = new URLSearchParams(window.location.search)
const scenario = params.get('scenario') || 'normal'
const mobile = params.has('mobile')

const today = moment().startOf('day').add(8, 'hours').valueOf()
let sortIndex = 100000
const task = (projectId, id, name, fields = {}) => ({
    id,
    projectId,
    name,
    dueDate: today - (fields.daysOverdue || 0) * 86400000,
    priority: 'none',
    timesPostponed: 0,
    estimations: { [-1]: 30 },
    sortIndex: sortIndex--,
    parentId: null,
    done: false,
    inDone: false,
    isPublicFor: [0],
    ...fields,
})

const NAMES = {
    product: [
        'Review MR for AT-3131',
        'Write release notes',
        'Triage support inbox',
        'Fix login flicker',
        'Update roadmap doc',
        'Plan Q1 OKRs',
        'Prepare App Store screenshots',
        'Answer Karla about Juno',
        'Clean up feature flags',
        'Check Sentry errors',
        'Draft MCP blog post',
        'Test offline notes',
        'Pricing page copy',
        'Onboarding email A/B',
        'Refactor task list header',
        'Interview candidate notes',
    ],
    client: [
        'Send invoice October',
        'Workshop agenda',
        'Call with Michael',
        'Proposal for Werkbank',
        'Insights feedback review',
        'Update CRM',
        'Follow up with Sebastian',
        'Story Builder demo',
        'Contract redlines',
        'Quarterly report',
    ],
    home: [
        'Kita forms',
        'Book Bürgeramt appointment',
        'Sell chairs on Kleinanzeigen',
        'Tax documents',
        'Christmas Garden tickets',
        'Garage key card',
        'Renew passport',
        'Plan weekend trip',
    ],
}
const ESTIMATES = [30, 60, 15, 120, 30, 45, 60, 0, 30, 15, 60, 240, 30, 0, 60, 30]
const PRIORITIES = [
    'must_do',
    'none',
    'should_do',
    'none',
    'could_do',
    'none',
    'none',
    'do_later',
    'none',
    'should_do',
    'none',
    'none',
    'none',
    'none',
    'none',
    'none',
]
const POSTPONED = [0, 0, 1, 2, 0, 3, 6, 7, 1, 0, 4, 5, 2, 8, 0, 1]

const build = () => {
    const map = { product: {}, client: {}, home: {} }
    Object.keys(NAMES).forEach((projectId, projectIndex) => {
        NAMES[projectId].forEach((name, index) => {
            const k = (index + projectIndex * 3) % 16
            const id = `${projectId}-${index}`
            map[projectId][id] = task(projectId, id, name, {
                estimations: { [-1]: ESTIMATES[k] },
                priority: scenario === 'overload' && index < 5 ? 'must_do' : PRIORITIES[k],
                timesPostponed: POSTPONED[k],
                parentGoalId: index % 4 === 1 ? 'goal-1' : null,
                daysOverdue: POSTPONED[k],
            })
        })
    })
    map.product.meeting = task('product', 'meeting', 'Weekly sync', {
        calendarData: { start: { dateTime: 'x' }, end: { dateTime: 'y' } },
    })
    return map
}

const views = {
    normal: {
        status: 'ready',
        workingHours: { start: '09:00', end: '18:00', isDefault: false },
        windowMinutes: 540,
        meetingMinutes: 90,
        freeMinutes: 450,
        meetingCount: 2,
    },
    overload: {
        status: 'ready',
        workingHours: { start: '09:00', end: '18:00', isDefault: false },
        windowMinutes: 540,
        meetingMinutes: 330,
        freeMinutes: 210,
        meetingCount: 5,
    },
    nocal: {
        status: 'noCalendar',
        workingHours: { start: '09:00', end: '18:00', isDefault: true },
        windowMinutes: 540,
    },
}

store.dispatch({ type: 'harness/openTasksMap', openTasksMap: build() })
store.dispatch({ type: 'harness/merge', state: { smallScreenNavigation: mobile } })
window.__store = store

const App = () => (
    <Provider store={store}>
        <div style={{ display: 'flex', justifyContent: mobile ? 'flex-end' : 'flex-start', padding: 8 }}>
            <DailyPlanEntry meetingView={views[scenario]} />
        </div>
    </Provider>
)
createRoot(document.getElementById('root')).render(<App />)
