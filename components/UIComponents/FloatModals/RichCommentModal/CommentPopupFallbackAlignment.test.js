import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { StyleSheet } from 'react-native'

import CommentPopupObjectHeader, { COMMENT_POPUP_OBJECT_LOAD_TIMEOUT_MS } from './CommentPopupObjectHeader'
import { getParentObjectData } from '../../../../utils/backends/Chats/chatsComments'

/**
 * AT-2528: in the comment popup's "details unavailable" / "details reconnecting" card the
 * title sat 12px further right than the sentence under it.
 *
 * The title is rendered through `Header` -> `ObjectHeaderParser`, and that parser indents
 * itself (`body: { marginLeft: 12 }`) because in a feed row it sits beside an avatar. The
 * card supplies its own `padding: 12`, so the two stacked and the title started at 24
 * while the message started at 12.
 *
 * These tests therefore drive the REAL `Header` and the REAL `ObjectHeaderParser`: the
 * defect lives in how the card's padding and the parser's own margin compose, which a
 * mocked header cannot express. The sibling `CommentPopupObjectHeader.test.js` mocks
 * `./Header`, which is exactly why it stayed green throughout.
 */

// Rendering the real header pulls in the real ObjectHeaderParser, and with it the redux
// store module, so only `useSelector` may be replaced here - `connect` is still needed by
// @hello-pangea/dnd further down that import chain.
jest.mock('react-redux', () => ({
    ...jest.requireActual('react-redux'),
    useSelector: selector =>
        selector({
            loggedUserProjects: [{ id: 'project-1' }],
            isMiddleScreen: false,
            smallScreenNavigation: false,
        }),
}))
jest.mock('uuid/v4', () => () => 'watcher-1')
// Only `translate` is overridden: the real module is imported transitively by half the app
// and dropping e.g. `getDeviceLanguage` breaks module evaluation far away from here.
jest.mock('../../../../i18n/TranslationService', () => {
    const en = require('../../../../i18n/translations/en.json')
    return {
        ...jest.requireActual('../../../../i18n/TranslationService'),
        translate: key => (key in en ? en[key] : key),
    }
})
jest.mock('../../../../utils/backends/Chats/chatsComments', () => ({ getParentObjectData: jest.fn() }))
jest.mock('../../../../utils/backends/Tasks/tasksFirestore', () => ({ watchTask: jest.fn() }))
jest.mock('../../../../utils/backends/Goals/goalsFirestore', () => ({ watchGoal: jest.fn() }))
jest.mock('../../../../utils/backends/Skills/skillsFirestore', () => ({ watchSkill: jest.fn() }))
jest.mock('../../../../utils/backends/Chats/chatsFirestore', () => ({ watchChat: jest.fn() }))
jest.mock('../../../../utils/backends/Contacts/contactsFirestore', () => ({ watchContactData: jest.fn() }))
jest.mock('../../../../utils/backends/firestore', () => ({
    unwatch: jest.fn(),
    unwatchNote: jest.fn(),
    watchNote: jest.fn(),
    watchUserData: jest.fn(),
}))
jest.mock('../../../SettingsView/ProjectsSettings/ProjectHelper', () => ({ getProjectById: () => null }))
jest.mock('../../../TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    default: { getUserInProject: () => null, getDataFromMention: () => ({ mention: '', user: null }) },
}))
jest.mock('../../../TaskListView/TaskItem/TaskPresentation/TaskPresentation', () => 'TaskPresentation')
jest.mock('../../../GoalsView/GoalItemPresentation', () => 'GoalItemPresentation')
jest.mock('../../../ContactsView/ContactItem', () => 'ContactItem')
jest.mock('../../../NotesView/NotesItem', () => 'NotesItem')
jest.mock('../../../ChatsView/ChatItem', () => 'ChatItem')
jest.mock('../../../SettingsView/Profile/Skills/SkillItem/SkillPresentation', () => 'SkillPresentation')
jest.mock('../../../AdminPanel/Assistants/AssistantPresentation', () => 'AssistantPresentation')
jest.mock('../../../../utils/HelperFunctions', () => ({ getPopoverWidth: () => 432 }))
// `./Header` is deliberately NOT mocked.

const TITLE = 'User Description Update'

/**
 * The horizontal offset the first glyph of `node` starts at, measured from the popup's
 * content box: every margin/padding it inherits from an ancestor. This is the same
 * quantity the AT-2528 screenshot was measured with.
 *
 * react-test-renderer hands out a fresh wrapper object on every `.parent` access, so the
 * walk cannot stop on object identity; it simply runs to the root, above which nothing in
 * this subtree carries a style. Host nodes are skipped because react-native-web compiles
 * the react-native style into a className and leaves only font/colour bits inline.
 */
const leftInset = node => {
    let total = 0
    for (let current = node; current; current = current.parent) {
        if (typeof current.type === 'string') continue
        const style = StyleSheet.flatten(current.props?.style) || {}
        const margin = style.marginLeft ?? style.marginHorizontal ?? style.margin ?? 0
        const padding = style.paddingLeft ?? style.paddingHorizontal ?? style.padding ?? 0
        total += margin + padding
    }
    return total
}

// ObjectHeaderParser renders one <Text> per word, so a title is located by its first word
// while the single-string message is located by the whole sentence.
const findRenderedText = (tree, text) => {
    const matches = tree.root.findAll(node => node.children.includes(text))
    expect(matches.length).toBe(1)
    return matches[0]
}

const renderFallback = async ({ reconnecting }) => {
    // Reconnecting is "the read never came back"; unavailable is "the read said nothing".
    getParentObjectData.mockReturnValue(reconnecting ? new Promise(() => {}) : Promise.resolve({ object: null }))

    let tree
    await act(async () => {
        tree = renderer.create(
            <CommentPopupObjectHeader projectId="project-1" objectId="object-1" objectType="tasks" objectName={TITLE} />
        )
        await Promise.resolve()
    })

    if (reconnecting) {
        await act(async () => {
            jest.advanceTimersByTime(COMMENT_POPUP_OBJECT_LOAD_TIMEOUT_MS + 1)
        })
    }

    return tree
}

describe('comment popup fallback card alignment (AT-2528)', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        jest.useFakeTimers()
    })
    afterEach(() => jest.useRealTimers())

    it.each([
        ['reconnecting', true, 'Task details are reconnecting. You can continue commenting.'],
        ['unavailable', false, 'This task is no longer available.'],
    ])('starts the title and the %s message at the same left inset', async (_label, reconnecting, message) => {
        const tree = await renderFallback({ reconnecting })

        const titleInset = leftInset(findRenderedText(tree, 'User'))
        const messageInset = leftInset(findRenderedText(tree, message))

        expect(titleInset).toBe(messageInset)
        // The card's own padding and nothing else. Before the fix the title was at 24,
        // because ObjectHeaderParser's feed-row margin stacked on top of it.
        expect(titleInset).toBe(12)
    })

    it('keeps the title and the message as one block, like the "No comments yet" card', async () => {
        const tree = await renderFallback({ reconnecting: true })

        let gap = null
        for (let node = findRenderedText(tree, 'User'); node; node = node.parent) {
            const marginBottom = StyleSheet.flatten(node.props?.style)?.marginBottom
            if (marginBottom != null) {
                gap = marginBottom
                break
            }
        }

        expect(gap).toBe(4)
    })
})
