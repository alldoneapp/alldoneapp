/**
 * AT-2397 browser regression harness — entry point.
 *
 * The defect is a CSS stacking-order bug, and jsdom (which every Jest suite in
 * this repo runs on) implements no paint order at all: it will happily report
 * two overlapping elements and has no opinion about which one the user can see.
 * A unit test can therefore only assert on the z-index VALUES and reason about
 * the rest — it cannot verify the claim the fix actually makes, which is "the
 * mention list is the element under the cursor".
 *
 * So this harness reproduces the real geometry in real Chromium:
 *
 *   - a popover host styled exactly like the "Add task" popup
 *     (components/Tags/AddTaskTag.js: `containerStyle={{ zIndex: 9999,
 *     overflow: 'visible' }}`), and
 *   - the REAL `WrapperMentionsModal`, positioned to overlap it, exactly as
 *     CustomTextInput3 mounts it from inside that popup.
 *
 * Both are portaled to `document.body` by the vendored popover library, so they
 * are siblings in the root stacking context — which is the whole reason the
 * mention list being nested inside the popup's React tree does not help it.
 *
 * `run.js` then asks the browser `document.elementFromPoint()` over the overlap:
 * the answer must belong to the mention portal. Before the fix the mention
 * container carried no z-index at all and the host popup's 9999 won every time,
 * regardless of DOM order.
 *
 * The host popup is deliberately a plain popover carrying AddTaskTag's real
 * container style rather than AddTaskTag itself: the harness must be able to run
 * against the ORIGINAL code to prove it catches the defect, and mounting the
 * full create-task popup would drag in project/user fixtures that have nothing
 * to do with stacking.
 */
import 'setimmediate'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import Popover from 'react-tiny-popover'

import store from '../../redux/store'
import WrapperMentionsModal from '../../components/Feeds/CommentsTextInput/WrapperMentionsModal'

const PROJECT_ID = 'proj-1'

// Where the fake "Add task" card sits, and where the caret-anchored mention
// list is asked to open — chosen so the list lands well inside the card, the
// way it does when you type "@" on the first line of the real popup.
const HOST_CARD = { top: 80, left: 60, width: 460, height: 420 }
const CARET_LOCATION = { top: 140, left: 110 }

const hostCardStyle = {
    width: HOST_CARD.width,
    height: HOST_CARD.height,
    // Opaque on purpose: this is what hid the mention list in production.
    background: '#2b3b57',
    borderRadius: 8,
}

function Harness() {
    return (
        <>
            <Popover
                content={<div id="add-task-card" style={hostCardStyle} />}
                isOpen={true}
                // The real "Add task" popup's container style, verbatim.
                containerStyle={{ zIndex: 9999, overflow: 'visible' }}
                contentLocation={{ top: HOST_CARD.top, left: HOST_CARD.left }}
            >
                <span />
            </Popover>
            <WrapperMentionsModal
                mentionText=""
                selectItemToMention={() => {}}
                projectId={PROJECT_ID}
                contentLocation={CARET_LOCATION}
                setMentionModalHeight={() => {}}
                keepFocus={() => {}}
                inMentionsEditionTag={false}
                insertNormalMention={() => {}}
            />
        </>
    )
}

createRoot(document.getElementById('root')).render(
    <Provider store={store}>
        <Harness />
    </Provider>
)

const rect = element => {
    if (!element) return null
    const { x, y, width, height } = element.getBoundingClientRect()
    return { x, y, width, height, right: x + width, bottom: y + height }
}

const containers = () => Array.from(document.querySelectorAll('.react-tiny-popover-container'))

// The mention portal is the container that is NOT the one holding the fake card.
const findPortals = () => {
    const all = containers()
    const hostPortal = all.find(node => node.querySelector('#add-task-card')) || null
    const mentionPortal = all.find(node => node !== hostPortal) || null
    return { hostPortal, mentionPortal }
}

window.__probe = () => {
    const { hostPortal, mentionPortal } = findPortals()
    if (!hostPortal || !mentionPortal) {
        return { ready: false, containerCount: containers().length }
    }

    const mentionRect = rect(mentionPortal)
    const hostRect = rect(hostPortal)

    // Probe the centre of the region where the two actually overlap, so the
    // question asked is precisely "who is on top where both are painted".
    const overlap = {
        left: Math.max(mentionRect.x, hostRect.x),
        right: Math.min(mentionRect.right, hostRect.right),
        top: Math.max(mentionRect.y, hostRect.y),
        bottom: Math.min(mentionRect.bottom, hostRect.bottom),
    }
    const overlaps = overlap.right > overlap.left && overlap.bottom > overlap.top
    const point = overlaps
        ? { x: (overlap.left + overlap.right) / 2, y: (overlap.top + overlap.bottom) / 2 }
        : { x: mentionRect.x + mentionRect.width / 2, y: mentionRect.y + mentionRect.height / 2 }

    const hit = document.elementFromPoint(point.x, point.y)
    const inMention = !!(hit && mentionPortal.contains(hit))
    const inHost = !!(hit && hostPortal.contains(hit))

    return {
        ready: true,
        overlaps,
        point,
        // '' when the element carries no z-index, which is the pre-fix state.
        mentionZIndex: mentionPortal.style.zIndex,
        hostZIndex: hostPortal.style.zIndex,
        mentionRect,
        hostRect,
        hitInMentionPortal: inMention,
        hitInHostPortal: inHost,
        hitTag: hit ? hit.tagName : null,
    }
}

window.__ready = true
