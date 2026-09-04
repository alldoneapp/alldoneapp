/**
 * @jest-environment jsdom
 */

/**
 * AT-2511 follow-up — the arrival actually reaching the screen, through the REAL chain.
 *
 * The suites that shipped with the feature cover its two halves and, between them, leave the seam
 * uncovered — which is exactly where it broke in production:
 *
 *   - `lastCommentArrivalWiring.test.js` renders the real container but MOCKS
 *     `LastAssistantCommentWrapper`, asserting on the `arrivalId` prop handed to that stub. It
 *     therefore proves the container announces an arrival, and nothing about who receives it.
 *   - the same file's card block renders `LastAssistantComment` DIRECTLY with a hand-written
 *     `arrivalId`, so it proves the card animates when told to, and nothing about being told.
 *   - `browser-tests/at2511` renders that same card directly too.
 *
 * Nothing rendered container → wrapper → card, and the wrapper's ordinary (no-modal) branch dropped
 * `arrivalId` on the floor. Every one of the 96 jest checks and 78 Chromium checks stayed green
 * while the animation could not run at all for any user.
 *
 * So this suite deliberately mocks NOTHING between the Firestore watcher and the rendered rows. It
 * drives the update path the app really takes — a `watchComments` snapshot — and asserts on what the
 * card ends up rendering.
 *
 * It also pins the second defect that shape hid: the arrival id lands one commit AFTER the new
 * comment text (the container publishes it from an effect), so "the row that was painted last" is
 * already the NEW row by the time the card arms. The previous suites could not see it because both
 * of them deliver text and id in a single update, which the app never does.
 */

import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import LastUserOrAssistantCommentContainer from './LastUserOrAssistantCommentContainer'
import { watchComments } from '../../../../utils/backends/Chats/chatsComments'
import { resetLastCommentArrivals } from './lastCommentArrival'

const mockState = {
    loggedUser: { uid: 'user-1' },
    defaultAssistant: { uid: 'assistant-default' },
    projectChatNotifications: {},
    selectedProjectIndex: 0,
    smallScreenNavigation: true,
    openModals: {},
    assistantEnabled: false,
    isQuillTagEditorOpen: false,
}

jest.mock('react-redux', () => ({
    ...jest.requireActual('react-redux'),
    useSelector: selector => selector(mockState),
    useDispatch: () => () => {},
}))

jest.mock('../../../../utils/backends/Chats/chatsFirestore', () => ({
    watchChat: jest.fn((projectId, objectId, watcherKey, callback) => {
        callback({ title: 'A topic', assistantId: 'assistant-1' })
    }),
}))

jest.mock('../../../../utils/backends/Chats/chatsComments', () => ({
    watchComments: jest.fn(),
    createObjectMessage: jest.fn(),
}))

jest.mock('../../../../utils/backends/firestore', () => ({
    unwatch: jest.fn(),
}))

jest.mock('../AssistantLineSkeleton', () => {
    const React = require('react')
    const { View } = require('react-native')
    return {
        LastCommentPreviewSkeleton: props => <View testID="assistant-last-comment-loading-skeleton" {...props} />,
    }
})

jest.mock('../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({
    checkIfSelectedAllProjects: () => false,
}))

jest.mock('./ProjectTagIndicator', () => () => null)

// Only ever mounted behind `showModal`; kept out so this suite does not drag the whole modal graph
// in. The wrapper itself — the component that was dropping the prop — is deliberately REAL.
jest.mock(
    '../../../UIComponents/ModalShell/AppPopover',
    () =>
        ({ children }) =>
            children
)
jest.mock('../../../UIComponents/FloatModals/RichCommentModal/RichCommentModal', () => () => null)

const project = { id: 'project-1', assistantId: 'assistant-project' }

const OLD = 'The comment that was already on screen'
const NEW = 'The answer that just landed'

/**
 * jest keeps every animation in this codebase inert (`__mocks__/react-native.js`), so a suite that
 * wants to observe the roll has to opt out — otherwise "there is no outgoing row" passes for the
 * wrong reason, which is the failure mode this whole file exists to remove.
 */
const withAnimationsEnabled = fn => {
    const previous = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
        return fn()
    } finally {
        process.env.NODE_ENV = previous
    }
}

const emitComment = (commentText, extra = {}) => {
    const handler = watchComments.mock.calls[watchComments.mock.calls.length - 1][5]
    act(() => {
        handler([{ id: commentText, commentText, ...extra }])
    })
}

/**
 * One streaming write, the shape `storeChunks` actually produces: the SAME document id rewritten
 * with a longer `commentText` while `isLoading` stays true and the run is `running`. The id is what
 * makes it one answer rather than five, which is exactly what the suppression keys on.
 */
const emitStreamingChunk = (commentId, commentText) =>
    emitComment(commentText, { id: commentId, isLoading: true, assistantRun: { status: 'running' } })

/** The settling write: same id, `isLoading` false, and — because writes are batched — longer text. */
const emitStreamCompletion = (commentId, commentText) =>
    emitComment(commentText, { id: commentId, isLoading: false, assistantRun: { status: 'completed' } })

const outgoingRows = tree => tree.root.findAllByProps({ testID: 'last-comment-outgoing-row' }, { deep: false })

const renderContainer = ({ objectId = 'chat-1', scopeKey = 'user-1:project-1:' } = {}) => {
    let tree
    act(() => {
        tree = renderer.create(
            <LastUserOrAssistantCommentContainer
                project={project}
                objectId={objectId}
                objectType="topics"
                setAModalIsOpen={() => {}}
                scopeKey={scopeKey}
            />
        )
    })
    return tree
}

/**
 * `SocialText` splits a comment into one <Text> per word, each carrying a trailing space as a second
 * child, so the words have to be flattened and re-joined before any phrase is findable.
 */
const rowText = (tree, testID) => {
    const row = tree.root.findAllByProps({ testID })[0]
    if (!row) return null
    return row
        .findAllByType(Text)
        .flatMap(node => [].concat(node.props.children))
        .filter(child => typeof child === 'string')
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
}

describe('AT-2511 — a comment arriving through the real update path animates', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        localStorage.clear()
        resetLastCommentArrivals()
    })

    /**
     * The regression itself. `LastAssistantCommentWrapper` renders the card from two branches and
     * only the popover one forwarded `arrivalId` — so in the ordinary case, which is every case in
     * which a comment actually arrives, the card was handed `null` and never armed.
     */
    it('mounts the outgoing row when a new comment lands on a slot that was showing one', () => {
        withAnimationsEnabled(() => {
            const tree = renderContainer()
            emitComment(OLD)
            emitComment(NEW)

            expect(tree.root.findAllByProps({ testID: 'last-comment-outgoing-row' }, { deep: false })).toHaveLength(1)
        })
    })

    /**
     * The second defect. A positional check cannot catch it: a roll that animates the SAME text
     * twice moves exactly as far, for exactly as long, and passes every geometric assertion. Only
     * reading the text out of the two rows separates "the old comment is leaving" from "the new
     * comment is leaving and arriving at once".
     */
    it('rolls the PREVIOUS comment away, not a second copy of the new one', () => {
        withAnimationsEnabled(() => {
            const tree = renderContainer()
            emitComment(OLD)
            emitComment(NEW)

            expect(rowText(tree, 'last-comment-outgoing-row')).toContain('already on screen')
            expect(rowText(tree, 'last-comment-incoming-row')).toContain('just landed')
        })
    })

    it('stays still for the comment the slot loads with', () => {
        withAnimationsEnabled(() => {
            const tree = renderContainer()
            emitComment(OLD)

            expect(tree.root.findAllByProps({ testID: 'last-comment-outgoing-row' }, { deep: false })).toHaveLength(0)
            expect(rowText(tree, 'last-comment-incoming-row')).toContain('already on screen')
        })
    })

    it('stays still when the watcher re-delivers the comment already on screen', () => {
        withAnimationsEnabled(() => {
            const tree = renderContainer()
            emitComment(OLD)
            emitComment(NEW)
            act(() => {
                tree.root.findAllByProps({ testID: 'last-comment-outgoing-row' }, { deep: false })
            })
            emitComment(NEW)

            expect(rowText(tree, 'last-comment-incoming-row')).toContain('just landed')
        })
    })

    /**
     * A comment landing in ANOTHER chat remounts this subtree (`LastComment` keys on the chat), so
     * the card is born already showing the new comment and there is nothing on screen to roll away.
     * The honest motion there is the incoming row rising into place alone — NOT the new comment
     * rolling out from under itself, which is what a naive "last painted row" capture produces.
     */
    it('rolls in alone across a remount, with no phantom copy leaving', () => {
        withAnimationsEnabled(() => {
            const first = renderContainer({ objectId: 'chat-1' })
            emitComment(OLD)
            act(() => first.unmount())

            const second = renderContainer({ objectId: 'chat-2' })
            emitComment(NEW)

            expect(rowText(second, 'last-comment-incoming-row')).toContain('just landed')
            expect(second.root.findAllByProps({ testID: 'last-comment-outgoing-row' }, { deep: false })).toHaveLength(0)
        })
    })
})

/**
 * AT-2511 follow-up — "when we are streaming the answer don't play the animation, just stream it".
 *
 * The streaming answer is written into ONE comment document that is rewritten as tokens accumulate,
 * so every batched write changed the text, changed the arrival key and fired a fresh roll. The card
 * rolled once per chunk: a slot machine, not an answer being typed.
 *
 * These cases drive the real container with the real watcher shape, because the whole question is
 * whether the run flags on the watcher documents reach the arrival detector — the card below sees
 * only `commentText`, by which a half-written answer and a finished one are identical.
 */
describe('AT-2511 — a streaming answer updates in place and never rolls', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        localStorage.clear()
        resetLastCommentArrivals()
    })

    it('never mounts an outgoing row across a whole streamed answer', () => {
        withAnimationsEnabled(() => {
            const tree = renderContainer()
            emitComment(OLD)

            const chunks = ['Working', 'Working on it', 'Working on it. Here is', 'Working on it. Here is the plan']
            chunks.forEach(text => {
                emitStreamingChunk('answer-1', text)
                expect(outgoingRows(tree)).toHaveLength(0)
            })
        })
    })

    it('shows each chunk in place, so the answer visibly grows', () => {
        withAnimationsEnabled(() => {
            const tree = renderContainer()
            emitComment(OLD)

            emitStreamingChunk('answer-1', 'Working on it')
            expect(rowText(tree, 'last-comment-incoming-row')).toContain('Working on it')

            emitStreamingChunk('answer-1', 'Working on it. Here is the plan')
            expect(rowText(tree, 'last-comment-incoming-row')).toContain('Here is the plan')
        })
    })

    /**
     * The edge that a bare "is it live right now?" check misses. Streaming writes are batched and
     * the run ends with a flush plus a final write, so the settled text is normally LONGER than the
     * last text written while live — a brand-new arrival key, arriving at the exact moment the user
     * has just finished watching the text appear.
     */
    it('stays still when the stream settles with more text than the last live write', () => {
        withAnimationsEnabled(() => {
            const tree = renderContainer()
            emitComment(OLD)

            emitStreamingChunk('answer-1', 'Working on it. Here is')
            emitStreamCompletion('answer-1', 'Working on it. Here is the plan for tomorrow.')

            expect(outgoingRows(tree)).toHaveLength(0)
            expect(rowText(tree, 'last-comment-incoming-row')).toContain('the plan for tomorrow')
        })
    })

    /**
     * The suppression must not outlive the answer it was granted for. The next genuinely new
     * comment is a different document, and it animates exactly as before — this is the assertion
     * that keeps the fix from degenerating into "the animation is off".
     */
    it('animates the NEXT comment normally once the stream has settled', () => {
        withAnimationsEnabled(() => {
            const tree = renderContainer()
            emitComment(OLD)

            emitStreamingChunk('answer-1', 'Working on it')
            emitStreamCompletion('answer-1', 'Working on it. All done.')
            expect(outgoingRows(tree)).toHaveLength(0)

            emitComment(NEW)

            expect(outgoingRows(tree)).toHaveLength(1)
            expect(rowText(tree, 'last-comment-outgoing-row')).toContain('All done')
            expect(rowText(tree, 'last-comment-incoming-row')).toContain('just landed')
        })
    })

    /**
     * A comment that was never streamed in THIS slot is a genuine arrival even though it is an
     * assistant answer — the user did not watch it appear here. This is the ordinary heartbeat / VM
     * result / other-thread case, and it must keep its flourish.
     */
    it('animates a settled answer that this slot never watched stream', () => {
        withAnimationsEnabled(() => {
            const tree = renderContainer()
            emitComment(OLD)
            emitStreamCompletion('answer-1', 'A finished answer from another thread')

            expect(outgoingRows(tree)).toHaveLength(1)
            expect(rowText(tree, 'last-comment-incoming-row')).toContain('finished answer')
        })
    })

    /**
     * A stream that is superseded before it settles must not leave a record behind that swallows a
     * later, genuine arrival of that same document.
     */
    it('does not let an abandoned stream suppress a later arrival of the same comment', () => {
        withAnimationsEnabled(() => {
            const tree = renderContainer()
            emitComment(OLD)

            emitStreamingChunk('answer-1', 'Half written')
            emitComment(NEW)
            emitStreamCompletion('answer-1', 'Half written, now finished')

            expect(outgoingRows(tree)).toHaveLength(1)
            expect(rowText(tree, 'last-comment-incoming-row')).toContain('now finished')
        })
    })
})
