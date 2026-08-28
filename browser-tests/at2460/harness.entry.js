/**
 * AT-2460 browser regression harness — entry point.
 *
 * "The celebration of empty inbox in All Projects > Tasks should be much more celebratory /
 *  longer. Also the new placement of the green dot should be a bigger deal."
 *
 * Why this cannot be a Jest test. This feature's entire history is animations that pass their
 * suites and are never seen: AT-2418 put the celebration on the one element that genuinely changes
 * and nobody could find it; AT-2445 found that a loading flash had been spending the day's
 * celebration before it was ever painted. Both were green throughout. The reason is structural —
 * jsdom has no layout and jest never advances `requestAnimationFrame`, so in a Jest test every
 * `Animated.Value` sits at whatever it was last `setValue`d to and every element is 0×0. A suite
 * there can prove that a layer is MOUNTED. It cannot prove that the dot actually grows, that the
 * confetti actually covers the page, or that the callout stays inside the card.
 *
 * So this mounts the REAL `AllProjectsEmptyInbox` — the real congrats block, the real
 * `EmptyInboxConfetti`, the real `EmptyInboxOverview` card with the real `EmptyInboxTodayDot` and
 * the real motion hooks — against the real redux store, and `run.js` measures what a browser
 * actually paints, frame by frame.
 *
 * The user is seeded with today already in `emptyInboxDays`, which is the "the inbox was cleared
 * somewhere else and the board is opened afterwards" case: mounting IS the trigger, so the run
 * starts at a known moment (`window.__mountedAt`).
 */
import 'setimmediate'
import React from 'react'
import { View } from 'react-native'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import moment from 'moment'

import store from '../../redux/store'
import AllProjectsEmptyInbox from '../../components/TaskListView/OpenTasksView/AllProjectsEmptyInbox'

const PROJECT_ID = 'proj-1'
const UID = 'user-1'

// Today plus the four days before it: a five-day streak, so the "Day 5" callout and the streak
// tick both have something real to say.
const emptyInboxDays = [4, 3, 2, 1, 0].map(daysAgo => moment().subtract(daysAgo, 'day').format('YYYY-MM-DD'))

const user = {
    uid: UID,
    displayName: 'Test User',
    email: 't@e.st',
    photoURL: '',
    photoURL300: '',
    defaultProjectId: PROJECT_ID,
    activeProjects: [PROJECT_ID],
    inactiveProjects: [],
    projectIds: [PROJECT_ID],
    isAnonymous: false,
    emptyInboxDays,
}

store.dispatch({ type: 'Init anonymous sesion', loggedUser: user, currentUser: user })
store.dispatch({
    type: 'Set project initial data',
    // `sortIndexByUser` is not decoration: `AllProjectsEmptyInboxTags` renders the project
    // shortcuts under the congratulation, and `ProjectHelper.sortProjects` indexes it by user id —
    // without it the whole block throws during render and every assertion below passes on an empty
    // page.
    project: {
        id: PROJECT_ID,
        name: 'Proj',
        color: '#ffffff',
        isShared: false,
        parentTemplateId: null,
        sortIndexByUser: { [UID]: 0 },
    },
    users: [user],
    workstreams: [],
    contacts: [],
    assistants: [],
})

const rect = node => {
    if (!node) return null
    const box = node.getBoundingClientRect()
    const style = window.getComputedStyle(node)

    return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        right: box.right,
        bottom: box.bottom,
        position: style.position,
        pointerEvents: style.pointerEvents,
        overflow: style.overflow,
        opacity: Number(style.opacity),
        backgroundColor: style.backgroundColor,
    }
}

const one = testID => rect(document.querySelector(`[data-testid="${testID}"]`))
const all = testID => [...document.querySelectorAll(`[data-testid="${testID}"]`)].map(rect)

/**
 * One frame of the celebration as the browser has actually laid it out. `run.js` samples this at
 * the moments each beat is supposed to own.
 */
window.__measure = () => ({
    t: Math.round(performance.now() - window.__mountedAt),
    viewport: { width: window.innerWidth, height: window.innerHeight },
    pageLayer: one('empty-inbox-confetti'),
    burstLayer: one('empty-inbox-confetti-burst'),
    pieces: all('empty-inbox-confetti-piece'),
    headline: one('empty-inbox-congrats-headline'),
    dotCell: one('empty-inbox-today-dot'),
    // The green square itself: this is the box that has to grow and come back.
    dotFill: one('empty-inbox-dot-fill'),
    callout: one('empty-inbox-dot-callout'),
    // Inset -1px on the achievement card, so it doubles as the card's own rectangle for the
    // "the callout never overhangs the card" check.
    spotlight: one('empty-inbox-card-spotlight'),
    streak: (() => {
        const node = document.querySelector('[data-testid="empty-inbox-streak-value"]')
        return node ? node.textContent.trim() : null
    })(),
})

// What the browser thinks is under a point, and whether anything on the way up would swallow a
// click there. This is how "the confetti covers the page" is told apart from "the confetti has
// taken the page hostage".
window.__hitTest = (x, y) => {
    const element = document.elementFromPoint(x, y)
    if (!element) return null
    const chain = []
    let node = element
    while (node && node !== document.body) {
        chain.push({
            tag: node.tagName,
            testID: node.getAttribute('data-testid') || null,
            pointerEvents: window.getComputedStyle(node).pointerEvents,
        })
        node = node.parentElement
    }
    return chain
}

/**
 * The beats, in milliseconds from mount, and the frames are captured IN THE PAGE at exactly those
 * moments.
 *
 * Sampling from the runner instead — `waitForTimeout` then `evaluate` — drifts by the round trip
 * of every step, and it drifts cumulatively: measured on this machine, marks of 300/950/1450 were
 * actually read at 538/1204/1718. That is not a rounding problem, it is the difference between
 * landing inside the hold and landing after it, so the assertions would start describing a
 * different beat than the one they name — and would do it differently on a slower machine.
 */
window.__MARKS = [
    // The congratulation's own beat: the card must still be untouched here.
    ['opening', 300],
    // The dot has just landed in the grid at cell size.
    ['land', 920],
    // The middle of the hold, where the dot is at full size and the callout is up.
    ['hold', 1300],
    // Late in the fall: the confetti must still be going, which is the "longer" half.
    ['late', 2400],
    // Everything over.
    ['settled', 3400],
]
window.__frames = {}
window.__framesDone = false

window.__mountedAt = performance.now()
window.__MARKS.forEach(([name, at], index) => {
    setTimeout(() => {
        window.__frames[name] = window.__measure()
        // Taken at the same instant as the frame it belongs to: "the confetti covers the page" and
        // "the confetti has taken the page hostage" look identical in a screenshot.
        window.__frames[name].hitCentre = window.__hitTest(window.innerWidth / 2, window.innerHeight / 2)
        if (index === window.__MARKS.length - 1) window.__framesDone = true
    }, at)
})

createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <View style={{ flex: 1, width: '100%' }}>
            <AllProjectsEmptyInbox showEmptyInboxOverview celebrateNewDay />
        </View>
    </Provider>
)
window.__ready = true
