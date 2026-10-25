/**
 * AT-2523 browser harness — the pending-send card arriving, and handing over, in a real browser.
 *
 * The card that appears the instant you press Enter (AT-2504) used to pop into place with no motion
 * at all, while every real comment beside it rolled. AT-2523 puts it on the same ticker. That is a
 * claim about pixels, and jest can observe none of it for the two reasons AT-2511 already
 * documented: `__mocks__/react-native.js` stubs `Animated.timing` into a no-op, and jsdom computes
 * no layout, so `onLayout` never fires and nothing is ever measured.
 *
 * What only this harness can prove:
 *   - the pending card ROLLS IN from a full card below, rather than appearing in place;
 *   - the comment that was in the slot rolls OUT under it — which crosses a component boundary
 *     (`LastAssistantComment` → `PendingAssistantCommentWrapper`), so it is only possible at all
 *     because of the slot memory in `lastCommentSlotRow.js`;
 *   - the assistant's answer then rolls the PENDING card away, completing the same gesture;
 *   - the roll is clipped and the card never changes height, so the assistant line cannot reflow.
 *
 * It renders the REAL components in the REAL order `LastCommentArea` renders them, sharing one
 * `scopeKey` — because the slot memory is keyed on exactly that, and a harness that passed
 * different keys would show no departure and look like a bug in the feature.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { StyleSheet, View } from 'react-native'
import { Provider } from 'react-redux'

import LastAssistantComment from '../../components/MyDayView/AssistantLine/LastComment/LastAssistantComment'
import PendingAssistantCommentWrapper from '../../components/MyDayView/AssistantLine/LastComment/PendingAssistantCommentWrapper'
import { LAST_COMMENT_PREVIEW_HEIGHT } from '../../components/MyDayView/AssistantLine/LastComment/lastCommentLayout'
import {
    PENDING_SEND_AWAITING_REPLY,
    PENDING_SEND_SENDING,
} from '../../components/MyDayView/AssistantLine/assistantLinePendingSend'
import store from '../../redux/store'

/**
 * The app's REAL store — see the note in `at2511/harness.entry.js`: the card renders
 * `ProjectTagIndicator` → `ProjectTag`, which resolves its project through the store SINGLETON
 * rather than the one handed to `<Provider>`.
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

const BEFORE = 'The answer that was already in this slot before anything was sent.'
const SUBMITTED = 'Move my three overdue tasks to today and tell me what changed.'
const ANSWERED = 'Done — I moved the three overdue tasks to today and left a note in the thread.'

// The one identity both cards file their row under. In the app `LastCommentArea` builds it from the
// user, the project key and (when scoped) the assistant.
const SCOPE_KEY = 'user-1:project-1:'

const PHASE_BEFORE = 'before'
const PHASE_PENDING = 'pending'
const PHASE_ANSWERED = 'answered'

// `LastCommentArea`'s own inset for the non-compact card (`previewInset` 16 + `LastComment`'s 16),
// so the clip and the badge overhang are measured inside the box they really ship in.
const areaStyles = StyleSheet.create({
    area: { width: 560, paddingLeft: 32, paddingTop: 24, backgroundColor: '#FFFFFF' },
})

const pendingEntry = (overrides = {}) => ({
    id: 'assistant-line-send-1',
    projectId: 'project-1',
    assistantId: 'assistant-1',
    assistantName: 'Anna',
    text: SUBMITTED,
    chatId: null,
    chatTitle: '',
    status: PENDING_SEND_SENDING,
    ...overrides,
})

function App() {
    const [phase, setPhase] = React.useState(PHASE_BEFORE)
    const [pending, setPending] = React.useState(pendingEntry)
    const [arrivalId, setArrivalId] = React.useState(null)
    const [compact, setCompact] = React.useState(false)

    // "The user pressed Enter": `LastCommentArea` swaps the preview out for the pending card in one
    // commit. No arrival id is passed — the pending card derives its own from the send.
    window.__send = () => setPhase(PHASE_PENDING)

    // "The topic exists": the send gains its chat id. Same card, no remount.
    window.__topicCreated = () =>
        setPending(current => ({
            ...current,
            chatId: 'chat-1',
            chatTitle: 'Anna <> Karsten 07.09.2026 3',
            status: PENDING_SEND_AWAITING_REPLY,
        }))

    // "The assistant answered": the pending entry is resolved and the real preview takes the slot
    // back, with an arrival id of its own — exactly what `LastCommentArea` does.
    window.__answer = () => {
        setPhase(PHASE_ANSWERED)
        setArrivalId(id => (id || 0) + 1)
    }

    window.__setCompact = setCompact

    return (
        <View style={areaStyles.area}>
            {phase === PHASE_PENDING ? (
                <PendingAssistantCommentWrapper
                    pending={pending}
                    assistantName={pending.assistantName}
                    compact={compact}
                    scopeKey={SCOPE_KEY}
                    setAModalIsOpen={() => {
                        window.__modalFlag = (window.__modalFlag || 0) + 1
                    }}
                />
            ) : (
                <LastAssistantComment
                    projectId="project-1"
                    commentText={phase === PHASE_ANSWERED ? ANSWERED : BEFORE}
                    objectName="Daily planning"
                    onPress={() => {
                        window.__pressed = (window.__pressed || 0) + 1
                    }}
                    isNew={false}
                    unreadComments={0}
                    isFollowedNotification={false}
                    compact={compact}
                    arrivalId={arrivalId}
                    scopeKey={SCOPE_KEY}
                />
            )}
        </View>
    )
}

const rect = testId => {
    const node = document.querySelector(`[data-testid="${testId}"]`)
    return node ? { node, box: node.getBoundingClientRect(), style: getComputedStyle(node) } : null
}

const visibleFraction = (box, cardBox) => {
    const top = Math.max(box.top, cardBox.top)
    const bottom = Math.min(box.bottom, cardBox.bottom)
    if (box.height <= 0) return 0
    return Number((Math.max(0, bottom - top) / box.height).toFixed(3))
}

/**
 * PAINTED geometry (`getBoundingClientRect` resolves transforms), never the `Animated.Value` behind
 * it — a value can advance while nothing moves, which is precisely the class of bug this exists to
 * catch.
 */
window.__measure = () => {
    const pendingCard = rect('assistant-pending-send')
    const previewCard = rect('last-comment-card')
    const card = pendingCard || previewCard
    if (!card) return { present: false }

    const viewport = rect('last-comment-roll-viewport')
    const incoming = rect('last-comment-incoming-row')
    const outgoing = rect('last-comment-outgoing-row')
    const offsetIn = layer => (layer ? Number((layer.box.top - card.box.top).toFixed(2)) : null)

    return {
        present: true,
        kind: pendingCard ? 'pending' : 'preview',
        cardHeight: Number(card.box.height.toFixed(2)),
        cardTop: Number(card.box.top.toFixed(2)),
        viewportOverflow: viewport ? viewport.style.overflow : null,
        incomingPresent: !!incoming,
        incomingY: offsetIn(incoming),
        outgoingPresent: !!outgoing,
        outgoingY: offsetIn(outgoing),
        incomingText: incoming ? incoming.node.textContent : null,
        outgoingText: outgoing ? outgoing.node.textContent : null,
        incomingVisible: incoming ? visibleFraction(incoming.box, card.box) : null,
        outgoingVisible: outgoing ? visibleFraction(outgoing.box, card.box) : null,
    }
}

/** What the user would see if the clip were missing or in the wrong place. */
window.__paintedOutsideCard = () => {
    const card = rect('assistant-pending-send') || rect('last-comment-card')
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

/** The card as a press target — the other half of AT-2523, and dead before it. */
window.__pressPendingCard = () => {
    const node = document.querySelector('[data-testid="assistant-pending-send"]')
    if (!node) return false
    node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    node.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    return true
}

window.__statusText = () => {
    const node = document.querySelector('[data-testid="assistant-pending-send-status"]')
    return node ? node.textContent : null
}

window.__expectedCardHeight = LAST_COMMENT_PREVIEW_HEIGHT

createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <App />
    </Provider>
)
window.__ready = true
