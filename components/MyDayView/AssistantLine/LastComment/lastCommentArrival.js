import { useEffect, useRef, useState } from 'react'

/**
 * AT-2511 — "is the comment in this slot one the user has not seen here yet?"
 *
 * The Last comment card swaps its content silently today, so the moment the assistant answers —
 * the payoff of the whole assistant line — looks identical to a re-render. Animating it needs one
 * thing the card cannot get from its own props: a way to tell an ARRIVAL from a RE-RENDER, and from
 * a first paint.
 *
 * ## Why this is not just `prevProps.commentText !== commentText`
 *
 * `LastComment` keys its child on the chat (`project:chatType:chatId`), so a comment arriving in a
 * DIFFERENT chat than the one on screen — which is the ordinary case for a heartbeat, a VM result,
 * or any thread other than the one you just wrote in — REMOUNTS the subtree. A component-local
 * "previous value" ref is born empty on that mount and can therefore never see the change it is
 * supposed to animate. The AT-2504 pending → reply handoff remounts for the same reason.
 *
 * So the memory has to outlive the mount, which is what this module is: a per-scope record of the
 * comment identity that slot last DISPLAYED. It is module state rather than redux for the reason
 * spelled out in `assistantLinePendingSend.js` and `threadAssistantModelState.js` (AT-2502): this
 * concerns one widget for half a second, and per AT-2336 a slice keyed by project id re-renders
 * every subscriber of that map on every write.
 *
 * ## First paint is never an arrival
 *
 * An empty record means "we have not shown anything here yet", NOT "everything is new" — the
 * AT-2445 lesson (a count of 0 also means "not counted yet"). A scope's first comment is therefore
 * recorded silently. That is what keeps the animation off a reload, a login, a project switch and
 * every navigation back into the view: those all show a comment that was already there, and
 * celebrating them would make the effect meaningless exactly when it should mean something.
 *
 * The memory is in-process on purpose. Persisting it would let a comment that arrived while the tab
 * was closed animate on the next boot, which is the same "congratulate the user for state, not for
 * an event" mistake in a different disguise.
 *
 * ## Identity is what is DISPLAYED, not the comment id
 *
 * `LastUserOrAssistantCommentContainer` renders from two sources: the localStorage preview cache
 * (`assistantLineCache`, which stores text + chat and NO comment id) and, a second later, the
 * Firestore watcher (which does carry `id`). Keying on the id where available and on the text
 * otherwise would make the cache → watcher handover look like a change and fire the animation on
 * every single load. One consistent identity — the chat plus the rendered text — cannot do that,
 * and it is also the honest question: if the text is identical, nothing visibly arrived.
 */

/**
 * A scope's record survives remounts but not a reload. Keyed by the caller's `scopeKey`, which
 * `LastCommentArea` builds from the user, the project key it subscribes to and the assistant it is
 * scoped to — i.e. exactly the identity of "this Last comment slot".
 *
 * Known trade-off: if two slots sharing one scope were ever mounted AT THE SAME TIME, the first
 * one's effect records the arrival and the second then finds its own record and stays still, so
 * only one of the two would animate. That is why the record is written and read in the same effect
 * rather than guarded per component — a shared scope must converge on "seen", never double-count.
 * It is not reachable today: every `AssistantLine` mount site is a mutually exclusive view or tab
 * (MyDay's open/done/workflow, the project board's open/done/pending/workflow, the assistant
 * board), and the collapsed chip replaces the expanded card rather than joining it. The failure
 * mode if that ever changes is a missing flourish on one of two visible cards — never a wrong
 * state, and never a crash.
 */
const seenCommentKeys = new Map()

/**
 * AT-2511 follow-up — the comment id this slot is currently watching STREAM, per scope.
 *
 * Needed because "do not animate while streaming" is not enough on its own. The assistant's
 * streaming writes are batched (`BATCH_UPDATE_CHUNK_THRESHOLD` in `storeChunks`) and the run ends
 * with `flushPendingUpdate()` + a final `safeCommentUpdate({ commentText, isLoading: false })`, so
 * the settled text is normally LONGER than the last text that was written while live. Suppressing
 * only the live renders would therefore let that final write through as a brand-new key and roll
 * the finished answer away and back in — the one moment the animation looks most like a glitch,
 * because the user has just watched the text appear.
 *
 * So the episode is remembered by comment id, which is stable across the whole stream (it is one
 * document being rewritten), and the settling write of that same id is swallowed too.
 *
 * It lives beside `seenCommentKeys` rather than in a ref for the same reason that map does: a
 * comment streaming in ANOTHER chat replaces this subtree, so a component-local memory is born
 * empty exactly when it is needed.
 */
const streamingCommentIds = new Map()

let arrivalCounter = 0

/**
 * FNV-1a over `chat|text`. The identity has to be comparable and bounded — a raw 500-character
 * comment as a Map key held for the session is a needless retention — and a collision here costs a
 * missed animation, nothing else.
 */
const digest = value => {
    let hash = 0x811c9dc5
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index)
        hash = Math.imul(hash, 0x01000193)
    }
    return (hash >>> 0).toString(36)
}

export const buildLastCommentKey = ({ objectType, objectId, commentText }) => {
    if (typeof commentText !== 'string') return null
    return `${objectType || ''}:${objectId || ''}:${commentText.length}:${digest(commentText)}`
}

export const getSeenLastCommentKey = scopeKey => (scopeKey ? seenCommentKeys.get(scopeKey) || null : null)

export const markLastCommentSeen = (scopeKey, commentKey) => {
    if (!scopeKey || !commentKey) return
    seenCommentKeys.set(scopeKey, commentKey)
}

export const getStreamingCommentId = scopeKey => (scopeKey ? streamingCommentIds.get(scopeKey) || null : null)

export const markLastCommentStreaming = (scopeKey, commentId) => {
    if (!scopeKey || !commentId) return
    streamingCommentIds.set(scopeKey, commentId)
}

export const clearLastCommentStreaming = scopeKey => {
    if (!scopeKey) return
    streamingCommentIds.delete(scopeKey)
}

/** Exported for tests: module-level state outlives a test file otherwise. */
export const resetLastCommentArrivals = () => {
    seenCommentKeys.clear()
    streamingCommentIds.clear()
    arrivalCounter = 0
}

/**
 * Returns a fresh `arrivalId` on the render after this scope starts showing a comment it has not
 * shown before, and `null` otherwise. A NUMBER rather than a boolean so two arrivals in a row
 * restart the motion instead of the second one being swallowed as "already animating" — the card
 * passes it straight into the animation's effect dependency list.
 *
 * The decision is made in an effect, not during render: the record write and the decision have to
 * be one atomic step, and a render-phase write would be re-run by React's double-invocation in
 * development and by any re-render before the commit lands.
 */
export const useLastCommentArrival = ({
    scopeKey,
    commentKey,
    commentId = null,
    isStreaming = false,
    enabled = true,
}) => {
    const [arrival, setArrival] = useState(null)
    // Guards the case where the same key is delivered again after an unrelated re-render: the
    // effect would find its own record and correctly do nothing, but only because the record was
    // written. This keeps that true even if the scope is cleared underneath us.
    const lastAnimatedKeyRef = useRef(null)

    useEffect(() => {
        if (!scopeKey || !commentKey) return

        const seen = getSeenLastCommentKey(scopeKey)
        markLastCommentSeen(scopeKey, commentKey)

        /**
         * A streamed answer is WATCHED, not announced.
         *
         * Every batched write during a stream changes `commentText` and therefore the key, so
         * without this the ticker rolled once per chunk — measured at one full roll per write — and
         * the card read as a slot machine rather than as an answer being typed. The text still
         * updates in place on every chunk; only the motion stands down.
         *
         * Recording the key on the way out is what makes the suppression self-limiting: by the time
         * the run settles, every text this slot has displayed is already marked seen, so nothing is
         * owed an animation retroactively.
         */
        if (isStreaming) {
            markLastCommentStreaming(scopeKey, commentId)
            lastAnimatedKeyRef.current = commentKey
            return
        }

        // The settling write of the very comment we just watched stream. Its text is normally
        // longer than the last live write (batched updates + a final flush), so it arrives as a new
        // key and would otherwise roll the finished answer away and back in.
        if (commentId && getStreamingCommentId(scopeKey) === commentId) {
            clearLastCommentStreaming(scopeKey)
            lastAnimatedKeyRef.current = commentKey
            return
        }

        // Any other comment ends the episode: a stream that was superseded before it settled must
        // not leave a record that suppresses a later, genuine arrival of the same id.
        clearLastCommentStreaming(scopeKey)

        // Nothing shown here before — record it and stay quiet.
        if (!seen) return
        if (seen === commentKey) return
        if (lastAnimatedKeyRef.current === commentKey) return

        lastAnimatedKeyRef.current = commentKey
        if (enabled) {
            arrivalCounter += 1
            setArrival(arrivalCounter)
        }
    }, [scopeKey, commentKey, commentId, isStreaming, enabled])

    return enabled ? arrival : null
}
