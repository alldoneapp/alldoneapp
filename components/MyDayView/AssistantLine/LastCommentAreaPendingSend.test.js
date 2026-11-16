/**
 * @jest-environment jsdom
 */

import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import LastCommentArea from './LastCommentArea'
import LastCommentText from './LastComment/LastCommentText'
import {
    beginAssistantLineSend,
    markAssistantLineSendCreated,
    resetAssistantLinePendingSends,
} from './assistantLinePendingSend'

const ALL_PROJECTS = 'allProjects'
let mockLastCommentProps = null
let mockCommentDataArgs = null

const mockState = {
    defaultAssistant: { uid: 'assistant-1' },
    selectedProjectIndex: 0,
    loggedUserProjects: [{ id: 'project-1', index: 0, name: 'Project one' }],
    loggedUserProjectsMap: { 'project-1': { id: 'project-1', index: 0, name: 'Project one', color: '#00CF8C' } },
    loggedUser: {
        defaultProjectId: 'project-1',
        lastAssistantCommentData: {},
        lastAssistantCommentDataByAssistant: {},
    },
    projectChatLastNotification: {},
}

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))

const mockOpenChatsList = jest.fn()
jest.mock('./openChatsList', () => ({ openChatsList: (...args) => mockOpenChatsList(...args) }))

jest.mock('../../../i18n/TranslationService', () => ({
    translate: (key, params) => (params?.name ? `${key}:${params.name}` : key),
}))

// The real module is the comments backend; only the key constant matters here.
jest.mock('../../../utils/backends/Chats/chatsComments', () => ({
    ASSISTANT_LAST_COMMENT_ALL_PROJECTS_KEY: 'allProjects',
}))

jest.mock('./AssistantOptions/helper', () => ({
    getAssistantLineData: () => ({
        assistant: { uid: 'assistant-1', displayName: 'Anna' },
        assistantProject: { id: 'project-1', index: 0, name: 'Project one' },
        assistantProjectId: 'project-1',
    }),
    getCommentData: (project, notification, lastCommentData) => {
        mockCommentDataArgs = { project, notification, lastCommentData }
        const source = notification || lastCommentData
        return {
            commentProject: source ? project || { id: source.projectId } : null,
            commentCreator: source ? { uid: 'assistant-1' } : null,
        }
    },
}))

// The real preview drags in the whole comment/tag rendering and navigation graph.
jest.mock('./LastComment/LastComment', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return props => {
        mockLastCommentProps = props
        return <Text testID="real-last-comment">real preview</Text>
    }
})

// Only `useReducedMotion` is replaced — it resolves `AccessibilityInfo` asynchronously, which this
// suite's synchronous `act` cannot flush. The ghost styles stay real: `LastCommentPreviewSkeleton`
// is one of the things under test here.
jest.mock('../../UIComponents/Ghosts/ghostAnimation', () => ({
    ...jest.requireActual('../../UIComponents/Ghosts/ghostAnimation'),
    useReducedMotion: () => false,
}))

/**
 * AT-2523 — the wrapper, not the card.
 *
 * `PendingAssistantCommentWrapper` owns the popover, which means `RichCommentModal`,
 * `AppPopover`, `redux/actions` and `createObjectMessage` — the whole graph this suite mocks
 * `LastComment` away to avoid. The CARD it renders is still the real one; only its shared text renderer is
 * mocked here to keep the slot wiring isolated. LastCommentText.test.js covers the real renderer. The popover half has its own suite,
 * `LastComment/PendingAssistantCommentWrapper.test.js`.
 */
let lastWrapperProps = null
jest.mock('./LastComment/PendingAssistantCommentWrapper', () => {
    const React = require('react')
    const PendingAssistantComment = require('./LastComment/PendingAssistantComment').default
    return props => {
        lastWrapperProps = props
        return (
            <PendingAssistantComment
                pending={props.pending}
                assistantName={props.assistantName}
                compact={props.compact}
                scopeKey={props.scopeKey}
            />
        )
    }
})

const setLastCommentData = data => {
    mockState.loggedUser.lastAssistantCommentData = data ? { 'project-1': data, [ALL_PROJECTS]: data } : {}
}

const begin = (overrides = {}) =>
    beginAssistantLineSend({
        keys: ['project-1', ALL_PROJECTS],
        projectId: 'project-1',
        assistantId: 'assistant-1',
        assistantName: 'Anna',
        text: 'a message I just sent',
        ...overrides,
    })

const render = (props = {}) => {
    let tree
    act(() => {
        tree = renderer.create(<LastCommentArea {...props} />)
    })
    return tree
}

const has = (tree, testID) => tree.root.findAllByProps({ testID }).length > 0

describe('LastCommentArea pending send (AT-2504)', () => {
    beforeEach(() => {
        resetAssistantLinePendingSends()
        mockState.selectedProjectIndex = 0
        setLastCommentData(null)
        mockState.projectChatLastNotification = {}
        lastWrapperProps = null
        mockLastCommentProps = null
        mockCommentDataArgs = null
    })

    describe('preview scope (AT-2602)', () => {
        it('uses the selected project pointers, including its followed unread comment', () => {
            const projectComment = {
                objectId: 'project-chat',
                objectType: 'topics',
                creatorType: 'assistant',
            }
            const globalComment = {
                objectId: 'other-project-chat',
                objectType: 'topics',
                creatorType: 'assistant',
                projectId: 'project-2',
            }
            const projectNotification = {
                chatId: 'followed-project-chat',
                chatType: 'topics',
                followed: true,
            }
            const globalNotification = {
                chatId: 'followed-other-project-chat',
                chatType: 'topics',
                followed: true,
                projectId: 'project-2',
            }
            mockState.loggedUser.lastAssistantCommentData = {
                'project-1': projectComment,
                [ALL_PROJECTS]: globalComment,
            }
            mockState.projectChatLastNotification = {
                'project-1': projectNotification,
                [ALL_PROJECTS]: globalNotification,
            }

            const tree = render({ useAssistantProjectContext: false, useGlobalLatestComment: false })

            expect(mockCommentDataArgs).toEqual({
                project: mockState.loggedUserProjects[0],
                notification: projectNotification,
                lastCommentData: projectComment,
            })
            expect(mockLastCommentProps.currentProjectChatLastNotification).toBe(projectNotification)
            expect(mockLastCommentProps.currentLastAssistantCommentData).toBe(projectComment)
            act(() => tree.unmount())
        })

        it('keeps All Projects and My Day on the global pointers', () => {
            const globalComment = {
                objectId: 'global-chat',
                objectType: 'topics',
                creatorType: 'assistant',
                projectId: 'project-1',
            }
            const globalNotification = {
                chatId: 'followed-global-chat',
                chatType: 'topics',
                followed: true,
                projectId: 'project-1',
            }
            mockState.selectedProjectIndex = -1
            mockState.loggedUser.lastAssistantCommentData = { [ALL_PROJECTS]: globalComment }
            mockState.projectChatLastNotification = { [ALL_PROJECTS]: globalNotification }

            const tree = render({ useAssistantProjectContext: false })

            expect(mockCommentDataArgs).toEqual({
                project: undefined,
                notification: globalNotification,
                lastCommentData: globalComment,
            })
            expect(mockLastCommentProps.currentProjectChatLastNotification).toBe(globalNotification)
            expect(mockLastCommentProps.currentLastAssistantCommentData).toBe(globalComment)
            act(() => tree.unmount())
        })
    })

    it('takes over the slot the answer will land in, ahead of the loading ghost', () => {
        // Nothing has ever been said here, so without a pending send this slot shows the ghost.
        const withoutPending = render()
        expect(has(withoutPending, 'assistant-last-comment-loading-skeleton')).toBe(true)
        act(() => withoutPending.unmount())

        begin()
        const tree = render()

        expect(has(tree, 'assistant-pending-send')).toBe(true)
        expect(has(tree, 'assistant-last-comment-loading-skeleton')).toBe(false)
        expect(tree.root.findByType(LastCommentText).props.commentText).toBe('a message I just sent')
        act(() => tree.unmount())
    })

    // 2026-11-13 — the comment's project is caption text in the header, "Last comment in ● Project",
    // and only on a line without a project of its own (the All projects line).
    const headerText = tree =>
        tree.root
            .findByProps({ testID: 'assistant-line-last-comment-label' })
            .findAllByType(Text)
            .map(node => node.props.children)

    it('names the pending send’s project in the header on the All projects line', () => {
        begin()
        const tree = render()

        expect(headerText(tree)).toEqual(['Last comment in', 'Project one'])
        act(() => tree.unmount())
    })

    it('does not name the project on a line that belongs to that project', () => {
        begin()
        const tree = render({ projectOverride: { id: 'project-1', index: 0 } })

        expect(headerText(tree)).toEqual(['Last comment'])
        act(() => tree.unmount())
    })

    it('names no project while the ghost is loading', () => {
        const tree = render()

        expect(headerText(tree)).toEqual(['Last comment'])
        act(() => tree.unmount())
    })

    it('replaces the previous comment rather than leaving a stale one on screen', () => {
        setLastCommentData({ objectId: 'older-chat', objectType: 'topics', creatorType: 'assistant' })

        const before = render()
        expect(has(before, 'real-last-comment')).toBe(true)
        act(() => before.unmount())

        begin()
        const tree = render()

        expect(has(tree, 'assistant-pending-send')).toBe(true)
        expect(has(tree, 'real-last-comment')).toBe(false)
        act(() => tree.unmount())
    })

    it('still shows on an assistant board that has no history at all', () => {
        // `scopeToAssistant` renders null with no stored pointer — which is exactly the state a
        // brand new assistant is in when you send it your first message.
        const withoutPending = render({ scopeToAssistant: true })
        expect(withoutPending.toJSON()).toBeNull()
        act(() => withoutPending.unmount())

        begin()
        const tree = render({ scopeToAssistant: true })
        expect(has(tree, 'assistant-pending-send')).toBe(true)
        act(() => tree.unmount())
    })

    it('does not show another assistant’s pending send on an assistant board', () => {
        begin({ assistantId: 'assistant-2' })

        const scoped = render({ scopeToAssistant: true })
        expect(scoped.toJSON()).toBeNull()
        act(() => scoped.unmount())

        // The ordinary project line is not scoped and still shows it.
        const unscoped = render()
        expect(has(unscoped, 'assistant-pending-send')).toBe(true)
        act(() => unscoped.unmount())
    })

    it('keeps waiting when the pointer moves to the new thread carrying the user’s OWN comment', () => {
        const id = begin()
        markAssistantLineSendCreated(id, 'chat-1')
        // `createObjectMessage` writes this one, client-side, as soon as the topic exists. It is
        // not the answer, and clearing on it would drop the indicator seconds too early.
        setLastCommentData({ objectId: 'chat-1', objectType: 'topics', creatorType: 'user' })

        const tree = render()
        expect(has(tree, 'assistant-pending-send')).toBe(true)
        expect(tree.root.findByProps({ testID: 'assistant-pending-send-status' }).props.children).toBe(
            'assistantLineWorkingOnIt:Anna'
        )
        act(() => tree.unmount())
    })

    it('hands the slot back once the assistant has answered', () => {
        const id = begin()
        markAssistantLineSendCreated(id, 'chat-1')
        setLastCommentData({ objectId: 'chat-1', objectType: 'topics', creatorType: 'assistant' })

        const tree = render()
        expect(has(tree, 'assistant-pending-send')).toBe(false)
        expect(has(tree, 'real-last-comment')).toBe(true)
        act(() => tree.unmount())
    })

    it('hands the slot back on a followed chat notification for that thread', () => {
        const id = begin()
        markAssistantLineSendCreated(id, 'chat-1')
        // The comment fan-out excludes its own creator, so a notification for this chat can only
        // have come from somebody other than us.
        mockState.projectChatLastNotification = {
            'project-1': { chatId: 'chat-1', chatType: 'topics', followed: true },
        }

        const tree = render()
        expect(has(tree, 'assistant-pending-send')).toBe(false)
        act(() => tree.unmount())
    })
    /**
     * AT-2523 — the card became something the user can open, which put it in direct conflict with
     * the thing that ends a pending send: the assistant answering. Without the hold, the popover
     * the user is reading is unmounted mid-sentence by the very answer they were waiting for.
     */
    describe('holding the card while its popover is open', () => {
        const openTheModal = () => act(() => lastWrapperProps.setAModalIsOpen(true))
        const closeTheModal = () => act(() => lastWrapperProps.setAModalIsOpen(false))

        it('keeps the card while the modal is up, even after the assistant answers', () => {
            const id = begin()
            markAssistantLineSendCreated(id, 'chat-1')
            const tree = render()
            openTheModal()

            setLastCommentData({ objectId: 'chat-1', objectType: 'topics', creatorType: 'assistant' })
            act(() => tree.update(<LastCommentArea />))

            expect(has(tree, 'assistant-pending-send')).toBe(true)
            act(() => tree.unmount())
        })

        it('hands the slot back once the modal closes', () => {
            const id = begin()
            markAssistantLineSendCreated(id, 'chat-1')
            const tree = render()
            openTheModal()
            setLastCommentData({ objectId: 'chat-1', objectType: 'topics', creatorType: 'assistant' })
            act(() => tree.update(<LastCommentArea />))

            closeTheModal()

            expect(has(tree, 'assistant-pending-send')).toBe(false)
            expect(has(tree, 'real-last-comment')).toBe(true)
            act(() => tree.unmount())
        })

        it('does not resurrect a finished send under a LATER popover on a real comment', () => {
            // The held copy is a fallback for one modal, not a second store. If it outlived its own
            // popover, opening the real card minutes later would swap a stale "working on it" card
            // back in — with no send behind it and nothing left to clear it.
            const id = begin()
            markAssistantLineSendCreated(id, 'chat-1')
            const tree = render()
            openTheModal()
            setLastCommentData({ objectId: 'chat-1', objectType: 'topics', creatorType: 'assistant' })
            act(() => tree.update(<LastCommentArea />))
            closeTheModal()

            // The real card's own popover opens; nothing is pending any more.
            const area = tree.root.findByProps({ testID: 'real-last-comment' })
            expect(area).toBeTruthy()
            act(() => tree.update(<LastCommentArea />))

            expect(has(tree, 'assistant-pending-send')).toBe(false)
            act(() => tree.unmount())
        })
    })
})

// AT-3020 — "All chats" sits on the header AND in the popover a card opens, and both lead to the
// same Chats list: the line's own project, or every project on the All projects line.
describe('LastCommentArea "All chats"', () => {
    beforeEach(() => {
        resetAssistantLinePendingSends()
        mockState.selectedProjectIndex = 0
        setLastCommentData(null)
        mockState.projectChatLastNotification = {}
        lastWrapperProps = null
        mockLastCommentProps = null
        mockOpenChatsList.mockClear()
    })

    const pressHeaderLink = tree =>
        act(() => tree.root.findByProps({ testID: 'assistant-line-all-chats' }).props.onPress())

    it('opens the line project’s chats from the header and from the comment popover', () => {
        setLastCommentData({ projectId: 'project-1', objectId: 'chat-1', objectType: 'topics' })
        const project = { id: 'project-1', index: 0 }
        const tree = render({ projectOverride: project })

        pressHeaderLink(tree)
        act(() => mockLastCommentProps.onOpenAllChats())

        expect(mockOpenChatsList.mock.calls).toEqual([[project], [project]])
        act(() => tree.unmount())
    })

    it('opens the chats of all projects from the All projects line', () => {
        setLastCommentData({ projectId: 'project-1', objectId: 'chat-1', objectType: 'topics' })
        const tree = render()

        act(() => mockLastCommentProps.onOpenAllChats())

        expect(mockOpenChatsList).toHaveBeenCalledWith(null)
        act(() => tree.unmount())
    })

    it('hands the link to the popover of a message still being sent', () => {
        begin()
        const project = { id: 'project-1', index: 0 }
        const tree = render({ projectOverride: project })

        act(() => lastWrapperProps.onOpenAllChats())

        expect(mockOpenChatsList).toHaveBeenCalledWith(project)
        act(() => tree.unmount())
    })
})

// AT-3034 follow-up: while the assistant-mode sidebar is open the assistant line hands its card
// style to this area, so every branch that renders something must carry it, and a branch that
// renders nothing leaves no card behind.
describe('LastCommentArea container style', () => {
    const cardStyle = { backgroundColor: '#ABCDEF', marginBottom: 24 }
    const outerStyleOf = tree => StyleSheet.flatten(tree.root.findAllByType(View)[0].props.style)

    beforeEach(() => {
        resetAssistantLinePendingSends()
        mockState.selectedProjectIndex = 0
        mockState.projectChatLastNotification = {}
        mockState.loggedUser.lastAssistantCommentDataByAssistant = {}
        setLastCommentData(null)
    })

    it('carries the style on the loading ghost, the real comment and a pending send', () => {
        const ghost = render({ style: cardStyle })
        expect(outerStyleOf(ghost)).toEqual(expect.objectContaining(cardStyle))
        act(() => ghost.unmount())

        setLastCommentData({ projectId: 'project-1', objectId: 'chat-1', objectType: 'topics' })
        const comment = render({ style: cardStyle })
        expect(has(comment, 'real-last-comment')).toBe(true)
        expect(outerStyleOf(comment)).toEqual(expect.objectContaining(cardStyle))
        act(() => comment.unmount())

        begin()
        const pending = render({ style: cardStyle })
        expect(outerStyleOf(pending)).toEqual(expect.objectContaining(cardStyle))
        act(() => pending.unmount())
    })

    it('renders nothing at all for an assistant without a comment of its own', () => {
        const tree = render({ style: cardStyle, scopeToAssistant: true })
        expect(tree.toJSON()).toBeNull()
        act(() => tree.unmount())
    })
})

// The slot wiring is covered here; real tag rendering lives in LastCommentText.test.js.
jest.mock('./LastComment/LastCommentText', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return ({ commentText, testID }) => <Text testID={testID}>{commentText}</Text>
})
