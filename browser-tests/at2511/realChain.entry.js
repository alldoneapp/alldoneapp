/**
 * AT-2511 real-chain harness — the arrival travelling the path it travels in production.
 *
 * `harness.entry.js` next door renders `LastAssistantComment` DIRECTLY and hands it an `arrivalId`
 * by hand. That proved the roll paints, and it is exactly why the feature could ship broken: the
 * component that decides whether the card is ever told about an arrival — `LastAssistantCommentWrapper`
 * — was never in the tree. It dropped `arrivalId` in its ordinary (no-modal) branch, so in production
 * the card was always handed `null` and the animation could not run for any user, while 78 Chromium
 * checks and 96 jest checks stayed green.
 *
 * This entry therefore mounts the REAL chain and mocks nothing inside it:
 *
 *     LastUserOrAssistantCommentContainer   (real — arrival detection, watcher effects, cache)
 *       └ LastAssistantCommentWrapper       (real — the component that dropped the prop)
 *           └ LastAssistantComment          (real — the card and its motion hook)
 *               └ LastCommentRow            (real — the rows whose text is read back)
 *
 * Only the Firestore leaves are faked, by `realChain.setup.js`, and a comment is delivered through
 * `window.__emitComment` — the same callback shape `watchComments` invokes.
 *
 * That delivery shape is the second thing being pinned. The container publishes `arrivalId` from an
 * EFFECT, so the new text paints one commit before the id describing it. Every earlier test set both
 * in a single update, which quietly made "the previous row" available when the app no longer has it —
 * so the card rolled the new answer out from under itself and every positional assertion still
 * passed. Reading the two rows' TEXT out of the painted DOM is the only check that separates them.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { StyleSheet, View } from 'react-native'
import { Provider } from 'react-redux'

import LastUserOrAssistantCommentContainer from '../../components/MyDayView/AssistantLine/LastComment/LastUserOrAssistantCommentContainer'
import { LAST_COMMENT_PREVIEW_HEIGHT } from '../../components/MyDayView/AssistantLine/LastComment/lastCommentLayout'
import store from '../../redux/store'

const PROJECT = { id: 'project-1', name: 'Alldone Product', color: '#2F80ED', index: 0, assistantId: 'assistant-1' }

// The app's REAL store: `ProjectTagIndicator` → `ProjectTag` resolves its project through
// `ProjectHelper.getProjectById`, which reads the store SINGLETON rather than the one handed to
// `<Provider>`.
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
store.dispatch({ type: 'Set logged user', loggedUser: { uid: 'user-1', defaultProjectId: PROJECT.id } })

const FIRST = 'The first thing this slot ever showed, already on screen before anything arrived.'
const ARRIVED = 'Done — I moved the three overdue tasks to today and left a note in the thread.'

window.__texts = { FIRST, ARRIVED }

// `LastCommentArea`'s own inset for the non-compact card (`previewInset` 16 + `LastComment`'s 16).
const areaStyles = StyleSheet.create({
    area: { width: 560, paddingLeft: 32, paddingTop: 24, backgroundColor: '#FFFFFF' },
})

function App() {
    // `LastComment` keys this child on the chat, so changing the chat id here reproduces the
    // REMOUNT case — a comment landing in a different thread (a heartbeat, a VM result, the AT-2504
    // pending → reply handoff), where there is no old comment on screen to roll away.
    const [chatId, setChatId] = React.useState('chat-1')
    const [compact, setCompact] = React.useState(false)
    window.__setChat = setChatId
    window.__setCompact = setCompact

    return (
        <View style={areaStyles.area}>
            <LastUserOrAssistantCommentContainer
                key={`${PROJECT.id}:topics:${chatId}`}
                project={PROJECT}
                objectId={chatId}
                objectType="topics"
                setAModalIsOpen={() => {}}
                compact={compact}
                scopeKey={`user-1:${PROJECT.id}:`}
            />
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

/** PAINTED geometry and text, never the `Animated.Value` behind them. */
window.__measure = () => {
    const card = rect('last-comment-card')
    const skeleton = document.querySelector('[data-testid="assistant-last-comment-loading-skeleton"]')
    if (!card) return { present: false, skeleton: !!skeleton }

    const incoming = rect('last-comment-incoming-row')
    const outgoing = rect('last-comment-outgoing-row')
    const badge = rect('unread-comments-badge')
    const offsetIn = layer => (layer ? Number((layer.box.top - card.box.top).toFixed(2)) : null)

    return {
        present: true,
        skeleton: !!skeleton,
        cardHeight: Number(card.box.height.toFixed(2)),
        cardTop: Number(card.box.top.toFixed(2)),
        incomingPresent: !!incoming,
        incomingY: offsetIn(incoming),
        outgoingPresent: !!outgoing,
        outgoingY: offsetIn(outgoing),
        incomingText: incoming ? incoming.node.textContent : null,
        outgoingText: outgoing ? outgoing.node.textContent : null,
        incomingVisible: incoming ? visibleFraction(incoming.box, card.box) : null,
        outgoingVisible: outgoing ? visibleFraction(outgoing.box, card.box) : null,
        badgePresent: !!badge,
        badgeWidth: badge ? Number(badge.box.width.toFixed(2)) : null,
    }
}

window.__expectedCardHeight = LAST_COMMENT_PREVIEW_HEIGHT

createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <App />
    </Provider>
)
window.__ready = true
