/**
 * AT-2511 browser harness — the last-comment ticker roll, actually painting.
 *
 * Renders the REAL `LastAssistantComment` driven by the REAL `useLastCommentArrivalMotion`, in the
 * REAL `LastCommentArea` inset geometry, against the app's real redux store.
 *
 * Jest can observe none of this, for two independent reasons that both matter:
 *   - `__mocks__/react-native.js` replaces `Animated.timing` with a no-op `{start}` stub, so no
 *     value ever advances on its own; and
 *   - jsdom computes no layout, so `onLayout` never fires and the roll distance would fall back to
 *     a constant — the very thing that has to be checked is that the two rows travel exactly one
 *     real card height, measured, with no gap opening between them.
 *
 * So the jest suites prove the roll is ARMED and that both rows share one value. Only this harness
 * proves a pixel moves, that the card CLIPS the roll, and that the card is still exactly as tall
 * while it happens.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { StyleSheet, View } from 'react-native'
import { Provider } from 'react-redux'

import LastAssistantComment from '../../components/MyDayView/AssistantLine/LastComment/LastAssistantComment'
import { LAST_COMMENT_PREVIEW_HEIGHT } from '../../components/MyDayView/AssistantLine/LastComment/lastCommentLayout'
import store from '../../redux/store'

/**
 * The app's REAL store, not a fake one. The card renders `ProjectTagIndicator` → `ProjectTag`,
 * which resolves its project through `ProjectHelper.getProjectById` — and that reads the store
 * SINGLETON rather than the one handed to `<Provider>`. A harness with its own store therefore
 * renders a card whose tag crashes on `finalProject.name`, which is exactly what the first run of
 * this harness did: three page errors and nothing mounted.
 */
const PROJECT = { id: 'project-1', name: 'Alldone Product', color: '#2F80ED', index: 0 }

store.dispatch({
    type: 'Set anonymous sesion data',
    project: PROJECT,
    users: [],
    workstreams: [],
    contacts: [],
    assistants: [],
    globalAssistants: [],
    administratorUser: {},
})

const FIRST = 'The first thing this slot ever showed, already on screen before anything arrived.'
const ARRIVED = 'Done — I moved the three overdue tasks to today and left a note in the thread.'

// `LastCommentArea`'s own inset for the non-compact card (`previewInset` 16 + `LastComment`'s 16),
// so the clip and the badge's -5 overhang are measured inside the box they really ship in.
const areaStyles = StyleSheet.create({
    area: { width: 560, paddingLeft: 32, paddingTop: 24, backgroundColor: '#FFFFFF' },
})

function App() {
    const [arrivalId, setArrivalId] = React.useState(null)
    const [commentText, setCommentText] = React.useState(FIRST)
    const [compact, setCompact] = React.useState(false)

    window.__arrive = () => {
        // The new comment and a fresh arrival id land in the SAME commit, exactly as they do in the
        // app — `LastUserOrAssistantCommentContainer` recomputes both from one Firestore snapshot.
        setCommentText(ARRIVED)
        setArrivalId(id => (id || 0) + 1)
    }
    window.__setCompact = setCompact

    return (
        <View style={areaStyles.area}>
            <LastAssistantComment
                projectId="project-1"
                commentText={commentText}
                objectName="Daily planning"
                onPress={() => {
                    window.__pressed = (window.__pressed || 0) + 1
                }}
                isNew={true}
                unreadComments={2}
                isFollowedNotification={true}
                compact={compact}
                arrivalId={arrivalId}
            />
        </View>
    )
}

const rect = testId => {
    const node = document.querySelector(`[data-testid="${testId}"]`)
    return node ? { node, box: node.getBoundingClientRect(), style: getComputedStyle(node) } : null
}

/**
 * PAINTED geometry (`getBoundingClientRect` resolves transforms) and computed style, never the
 * `Animated.Value` behind them. That distinction is the whole point: jest can read a value and
 * still be looking at an animation that never advanced a pixel.
 */
window.__measure = () => {
    const card = rect('last-comment-card')
    if (!card) return { present: false }
    const viewport = rect('last-comment-roll-viewport')
    const incoming = rect('last-comment-incoming-row')
    const outgoing = rect('last-comment-outgoing-row')
    const badge = rect('unread-comments-badge')

    // Each row's offset from where it rests, i.e. from the top of the card.
    const offsetIn = layer => (layer ? Number((layer.box.top - card.box.top).toFixed(2)) : null)

    return {
        present: true,
        cardHeight: Number(card.box.height.toFixed(2)),
        cardWidth: Math.round(card.box.width),
        cardTop: Number(card.box.top.toFixed(2)),
        cardOverflow: card.style.overflow,
        viewportOverflow: viewport ? viewport.style.overflow : null,
        viewportRadius: viewport ? viewport.style.borderRadius : null,
        incomingPresent: !!incoming,
        incomingY: offsetIn(incoming),
        outgoingPresent: !!outgoing,
        outgoingY: offsetIn(outgoing),
        // What the user can actually READ in each row — the check that the row rolling away is the
        // OLD comment and the one rolling in is the new one.
        incomingText: incoming ? incoming.node.textContent : null,
        outgoingText: outgoing ? outgoing.node.textContent : null,
        // How much of each row is inside the card's own box. The clip is what makes the roll a
        // roll rather than two comments sliding over the neighbouring UI.
        incomingVisible: incoming ? visibleFraction(incoming.box, card.box) : null,
        outgoingVisible: outgoing ? visibleFraction(outgoing.box, card.box) : null,
        badgePresent: !!badge,
        badgeWidth: badge ? Number(badge.box.width.toFixed(2)) : null,
        badgeRight: badge ? Number((badge.box.right - card.box.right).toFixed(2)) : null,
        badgePosition: badge ? badge.style.position : null,
        // The badge must remain fully painted throughout: it sits OUTSIDE the card, so a clip in
        // the wrong place would cut it off.
        badgeAboveCard: badge ? Number((card.box.top - badge.box.top).toFixed(2)) : null,
    }
}

const visibleFraction = (box, cardBox) => {
    const top = Math.max(box.top, cardBox.top)
    const bottom = Math.min(box.bottom, cardBox.bottom)
    if (box.height <= 0) return 0
    return Number((Math.max(0, bottom - top) / box.height).toFixed(3))
}

/**
 * What the user would see if the clip were missing or in the wrong place. Read from the real
 * painted tree rather than assumed: a `position: fixed` portal or a stray `overflow: visible`
 * anywhere up the chain would show here as content painted outside the card.
 */
window.__paintedOutsideCard = () => {
    const card = rect('last-comment-card')
    if (!card) return null
    return ['last-comment-incoming-row', 'last-comment-outgoing-row']
        .map(testId => {
            const layer = rect(testId)
            if (!layer) return null
            return {
                testId,
                aboveCard: Number(Math.max(0, card.box.top - layer.box.top).toFixed(2)),
                belowCard: Number(Math.max(0, layer.box.bottom - card.box.bottom).toFixed(2)),
            }
        })
        .filter(Boolean)
}

window.__expectedCardHeight = LAST_COMMENT_PREVIEW_HEIGHT

createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <App />
    </Provider>
)
window.__ready = true
