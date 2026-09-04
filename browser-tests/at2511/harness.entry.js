/**
 * AT-2511 browser harness — the last-comment arrival motion, actually painting.
 *
 * Renders the REAL `LastAssistantComment` driven by the REAL `useLastCommentArrivalMotion`, inside
 * the REAL `LastCommentArea` inset geometry, against a real react-redux store.
 *
 * Jest can observe none of this, for two independent reasons that both matter:
 *   - `__mocks__/react-native.js` replaces `Animated.timing` with a no-op `{start}` stub, so no
 *     value ever advances; and
 *   - jsdom computes no layout, so `onLayout` never fires and the band — which is gated on a
 *     MEASURED card width, deliberately, so it can never sweep a guessed distance — is never
 *     rendered at all.
 *
 * So the jest suites can prove the motion is ARMED and that the card's geometry is untouched. Only
 * this harness can prove a pixel moves, and that the card is still exactly as tall while it does.
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
// so the band's clip and the badge's -5 overhang are measured inside the box they really ship in.
const areaStyles = StyleSheet.create({
    area: { width: 560, paddingLeft: 32, paddingTop: 24, backgroundColor: '#FFFFFF' },
})

function App() {
    const [arrivalId, setArrivalId] = React.useState(null)
    const [commentText, setCommentText] = React.useState(FIRST)
    const [compact, setCompact] = React.useState(false)

    window.__arrive = () => {
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
 * PAINTED geometry (`getBoundingClientRect` resolves transforms) and computed opacity, never the
 * `Animated.Value` behind them. That distinction is the whole point: jest can read a value and
 * still be looking at an animation that never advanced a pixel.
 */
window.__measure = () => {
    const card = rect('last-comment-card')
    if (!card) return { present: false }
    const content = rect('last-comment-arrival-content')
    const band = rect('last-comment-arrival-band')
    const badge = rect('unread-comments-badge')

    return {
        present: true,
        cardHeight: Number(card.box.height.toFixed(2)),
        cardWidth: Math.round(card.box.width),
        cardTop: Number(card.box.top.toFixed(2)),
        // The content's own opacity, and how far below its resting place it currently sits.
        contentOpacity: content ? Number(content.style.opacity) : null,
        contentTop: content ? Number(content.box.top.toFixed(2)) : null,
        bandPresent: !!band,
        bandLeft: band ? Math.round(band.box.left - card.box.left) : null,
        bandWidth: band ? Math.round(band.box.width) : null,
        // A hard-edged accent rectangle sliding over the card would be worse than no band, so the
        // gradient is the only paint there is.
        bandImage: band ? band.style.backgroundImage : null,
        bandColor: band ? band.style.backgroundColor : null,
        badgePresent: !!badge,
        badgeWidth: badge ? Number(badge.box.width.toFixed(2)) : null,
        badgeRight: badge ? Number((badge.box.right - card.box.right).toFixed(2)) : null,
        badgePosition: badge ? badge.style.position : null,
    }
}

window.__expectedCardHeight = LAST_COMMENT_PREVIEW_HEIGHT

createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <App />
    </Provider>
)
window.__ready = true
