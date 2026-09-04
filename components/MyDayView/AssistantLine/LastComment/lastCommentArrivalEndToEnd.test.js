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

const emitComment = commentText => {
    const handler = watchComments.mock.calls[watchComments.mock.calls.length - 1][5]
    act(() => {
        handler([{ id: commentText, commentText }])
    })
}

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
