/**
 * @jest-environment jsdom
 */

// AT-3120: when the selected tag chip of Chats > Unread (e.g. "Ads" / Werbung) drops to zero, the
// next tag with unread messages is selected, in chip order and wrapping around (Karsten,
// 2026-11-20), whatever emptied it. Nothing switches on a transient loading state.

import React from 'react'
import renderer, { act } from 'react-test-renderer'

import UnreadMessagesList from './UnreadMessagesList'
import UnreadTriageEmptyState from './UnreadTriageEmptyState'
import { UnreadTriageTagChips } from './UnreadTriageFilters'
import {
    UnreadTriageProvider,
    getNextUnreadTag,
    isTriageScopeLoaded,
    useAutoAdvanceUnreadTag,
    useUnreadTriage,
} from './UnreadTriageContext'
import { UnreadEmailArchiveProvider } from '../unreadEmailArchiveContext'
import useGetUnreadChatMessages from '../../../hooks/Chats/useGetUnreadChatMessages'
import {
    UNREAD_TAG_ADS,
    UNREAD_TAG_ALL,
    UNREAD_TAG_ASSISTANT,
    UNREAD_TAG_EMAIL,
    UNREAD_TAG_NEWSLETTER,
    UNREAD_TAG_NOTIFICATION,
    UNREAD_TAG_PEOPLE,
} from './unreadMessageTags'

jest.mock('../../../hooks/Chats/useGetUnreadChatMessages', () => jest.fn())
jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
jest.mock('../../../utils/SharedHelper', () => ({ accessGranted: () => true }))
jest.mock('../../ContactsView/Utils/ContactsHelper', () => ({
    getUserPresentationData: () => ({ displayName: 'Jana Becker' }),
}))
jest.mock('../../ContactsView/Utils/useGetUserPresentationData', () => () => ({
    displayName: 'Jana Becker',
    photoURL: '',
}))
jest.mock('../../../utils/backends/EmailLine/emailCommentReadSync', () => ({ syncEmailCommentsReadState: jest.fn() }))
jest.mock('../../../utils/backends/EmailLine/emailLineBackend', () => ({ performEmailLineAction: jest.fn() }))
jest.mock('../../../utils/backends/Chats/markChatCommentsAsRead', () => ({
    markChatCommentsAsRead: jest.fn(async () => {}),
    clearChatCommentsForLinkedEmails: jest.fn(async () => async () => {}),
}))
jest.mock('../../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../Utils/ChatHelper', () => ({ onOpenChat: jest.fn() }))
jest.mock('../../TaskListView/EmailLine/emailLineHelper', () => ({ openUrlInNewTab: jest.fn() }))
jest.mock('../../UIComponents/FloatModals/DateFormatPickerModal', () => ({
    getDateFormat: () => 'DD.MM.YYYY',
    getTimeFormat: () => 'HH:mm',
}))
jest.mock('../../UIControls/SocialText/SocialText', () => {
    const { Text } = require('react-native')
    return ({ children }) => <Text>{children}</Text>
})
jest.mock('../../Icon', () => () => null)
jest.mock('../../../assets/svg/SVGGenericUser', () => () => null)
jest.mock(
    '../../UIComponents/ModalShell/AppPopover',
    () =>
        ({ children }) =>
            children
)
jest.mock('./UnreadEmailSettingsPopup', () => () => null)

let mockState

describe('getNextUnreadTag', () => {
    it('takes the next tag after the current one that still has unread messages', () => {
        expect(getNextUnreadTag(UNREAD_TAG_NOTIFICATION, { [UNREAD_TAG_ADS]: 2, [UNREAD_TAG_EMAIL]: 1 })).toBe(
            UNREAD_TAG_ADS
        )
        expect(getNextUnreadTag(UNREAD_TAG_ADS, { [UNREAD_TAG_EMAIL]: 3, [UNREAD_TAG_PEOPLE]: 1 })).toBe(
            UNREAD_TAG_EMAIL
        )
    })

    it('wraps around to the start of the chip order', () => {
        expect(getNextUnreadTag(UNREAD_TAG_ADS, { [UNREAD_TAG_PEOPLE]: 1, [UNREAD_TAG_NEWSLETTER]: 4 })).toBe(
            UNREAD_TAG_PEOPLE
        )
        expect(getNextUnreadTag(UNREAD_TAG_EMAIL, { [UNREAD_TAG_ASSISTANT]: 1 })).toBe(UNREAD_TAG_ASSISTANT)
    })

    it('is null when no other tag has unread messages, or for the "all" choice', () => {
        expect(getNextUnreadTag(UNREAD_TAG_ADS, { [UNREAD_TAG_ALL]: 0 })).toBeNull()
        expect(getNextUnreadTag(UNREAD_TAG_ADS, { [UNREAD_TAG_ADS]: 2 })).toBeNull()
        expect(getNextUnreadTag(UNREAD_TAG_ALL, { [UNREAD_TAG_PEOPLE]: 2 })).toBeNull()
    })
})

describe('isTriageScopeLoaded', () => {
    const entry = loaded => ({ counts: {}, visibleCommentRefs: [], loaded })

    it('waits for every registered project of the scope; unregistered ones do not block', () => {
        expect(isTriageScopeLoaded({ p1: entry(true), p2: entry(true) }, ['p1', 'p2', 'p3'])).toBe(true)
        expect(isTriageScopeLoaded({ p1: entry(true), p2: entry(false) }, ['p1', 'p2'])).toBe(false)
        // A project outside the scope (another selected project) does not count.
        expect(isTriageScopeLoaded({ p1: entry(true), p2: entry(false) }, ['p1'])).toBe(true)
    })
})

describe('useAutoAdvanceUnreadTag', () => {
    let triage
    function Harness({ projectIds }) {
        triage = useUnreadTriage()
        useAutoAdvanceUnreadTag(triage, projectIds)
        return null
    }
    const render = projectIds => {
        let tree
        act(() => {
            tree = renderer.create(
                <UnreadTriageProvider>
                    <Harness projectIds={projectIds} />
                </UnreadTriageProvider>
            )
        })
        return {
            tree,
            setScope: ids =>
                act(() =>
                    tree.update(
                        <UnreadTriageProvider>
                            <Harness projectIds={ids} />
                        </UnreadTriageProvider>
                    )
                ),
        }
    }
    const register = (projectId, counts, loaded = true) =>
        act(() => triage.registerProject(projectId, counts, [], loaded))

    const P1 = ['p1']

    it('moves on to the next tag with unread messages when the selected one empties', () => {
        render(P1)
        register('p1', { ads: 2, email: 1, people: 1 })
        act(() => triage.setTagFilter(UNREAD_TAG_ADS))
        register('p1', { ads: 1, email: 1, people: 1 })
        expect(triage.tagFilter).toBe(UNREAD_TAG_ADS)

        register('p1', { email: 1, people: 1 })
        expect(triage.tagFilter).toBe(UNREAD_TAG_EMAIL)

        // ...and from the last tag it wraps around to the first.
        register('p1', { people: 1 })
        expect(triage.tagFilter).toBe(UNREAD_TAG_PEOPLE)
    })

    it('stays on the emptied tag (its empty state) when no tag has unread messages left', () => {
        render(P1)
        register('p1', { ads: 1 })
        act(() => triage.setTagFilter(UNREAD_TAG_ADS))
        register('p1', {})
        expect(triage.tagFilter).toBe(UNREAD_TAG_ADS)
    })

    it('does not switch while a project of the scope is still loading', () => {
        render(['p1', 'p2'])
        register('p1', { ads: 1 })
        register('p2', { people: 1 })
        act(() => triage.setTagFilter(UNREAD_TAG_ADS))

        // A new chat arrives in p2 and its messages are still on the way; meanwhile the ad is read.
        register('p2', { people: 1 }, false)
        register('p1', {})
        expect(triage.tagFilter).toBe(UNREAD_TAG_ADS)

        // p2 finished loading and has a new ad: no switch, the tag has messages again.
        register('p2', { people: 1, ads: 1 })
        expect(triage.tagFilter).toBe(UNREAD_TAG_ADS)

        // That ad is archived too: now it moves on.
        register('p2', { people: 1 })
        expect(triage.tagFilter).toBe(UNREAD_TAG_PEOPLE)
    })

    it('switches once the scope has loaded if the tag emptied while it was loading', () => {
        render(P1)
        register('p1', { ads: 1, newsletter: 2 })
        act(() => triage.setTagFilter(UNREAD_TAG_ADS))
        register('p1', { newsletter: 2 }, false)
        expect(triage.tagFilter).toBe(UNREAD_TAG_ADS)
        register('p1', { newsletter: 2 })
        expect(triage.tagFilter).toBe(UNREAD_TAG_NEWSLETTER)
    })

    it('never jumps on a tag it has not seen with messages (no data yet, or another project)', () => {
        const { setScope } = render(P1)
        act(() => triage.setTagFilter(UNREAD_TAG_ADS))
        register('p1', { people: 1 }, false)
        register('p1', { people: 1 })
        expect(triage.tagFilter).toBe(UNREAD_TAG_ADS)

        // Seen with messages in p1, then the user switches to project p2, which has none: the
        // project context changed, it was not the user's processing, so the tag stays.
        register('p1', { ads: 1, people: 1 })
        register('p2', { people: 3 })
        setScope(['p2'])
        expect(triage.tagFilter).toBe(UNREAD_TAG_ADS)
    })

    it('does nothing without a tag filter', () => {
        render(P1)
        register('p1', { people: 1 })
        register('p1', {})
        expect(triage.tagFilter).toBe(UNREAD_TAG_ALL)
    })

    it('does not jump back on its own after the user re-selects the emptied tag', () => {
        render(P1)
        register('p1', { ads: 1, people: 1 })
        act(() => triage.setTagFilter(UNREAD_TAG_ADS))
        register('p1', { people: 1 })
        expect(triage.tagFilter).toBe(UNREAD_TAG_PEOPLE)

        // The selected chip is the only way back to an empty tag; once there it is not re-armed.
        act(() => triage.setTagFilter(UNREAD_TAG_ADS))
        expect(triage.tagFilter).toBe(UNREAD_TAG_ADS)
    })
})

describe('Chats > Unread with the tag chips (AT-3120)', () => {
    const project1 = { id: 'project-1' }
    const project2 = { id: 'project-2' }
    const emailsChat = { id: 'chat-emails', type: 'topics', title: 'Daily emails' }
    const taskChat = { id: 'chat-task', type: 'tasks', title: 'Compact task header' }
    const email = (id, labelKey, emailKind, created) => ({
        id,
        fromAssistant: true,
        creatorId: 'anna',
        created,
        commentText: `Email from Shop (shop@example.com): ${id}`,
        gmailData: { messageId: `m-${id}`, connectionId: 'conn-1', labelKey, emailKind },
    })
    const AD_1 = email('ad-1', 'ads', 'ads', 300)
    const AD_2 = email('ad-2', 'ads', 'ads', 250)
    const NEWS = email('news', '', 'newsletter', 200)
    const PERSON = { id: 'jana', fromAssistant: false, creatorId: 'jana', created: 100, commentText: 'Hi' }

    let messages
    let loaded
    let triage
    function TriageProbe() {
        triage = useUnreadTriage()
        return null
    }

    const renderView = () => {
        useGetUnreadChatMessages.mockImplementation((projectId, chatId) => ({
            messages: messages[`${projectId}/${chatId}`] || [],
            loaded: loaded[`${projectId}/${chatId}`] !== false,
        }))
        const projectIds = ['project-1', 'project-2']
        const element = () => (
            <UnreadEmailArchiveProvider>
                <UnreadTriageProvider>
                    <TriageProbe />
                    <UnreadTriageTagChips projectIds={projectIds} />
                    <UnreadTriageEmptyState projectIds={projectIds} />
                    <UnreadMessagesList project={project1} chats={[emailsChat]} />
                    <UnreadMessagesList project={project2} chats={[taskChat]} />
                </UnreadTriageProvider>
            </UnreadEmailArchiveProvider>
        )
        let tree
        act(() => {
            tree = renderer.create(element())
        })
        return { tree, rerender: () => act(() => tree.update(element())) }
    }
    // The chips on screen (testIDs repeat on the host nodes, hence the Set).
    const chipTags = tree => [
        ...new Set(
            tree.root
                .findAll(
                    node =>
                        typeof node.props.testID === 'string' &&
                        node.props.testID.startsWith('unread-tag-') &&
                        node.props.testID !== 'unread-tag-empty'
                )
                .map(node => node.props.testID)
        ),
    ]
    const pressChip = (tree, tag) =>
        act(() =>
            tree.root
                .findAll(node => node.props.testID === `unread-tag-${tag}` && node.props.onPress)[0]
                .props.onPress()
        )

    beforeEach(() => {
        jest.clearAllMocks()
        mockState = { loggedUser: { uid: 'user-1' }, smallScreenNavigation: false, projectChatNotifications: {} }
        messages = {
            'project-1/chat-emails': [AD_1, AD_2, NEWS],
            'project-2/chat-task': [PERSON],
        }
        loaded = {}
    })

    it('selects the next tag in chip order once the last ad is processed (Werbung -> wrap to people)', () => {
        const { tree, rerender } = renderView()
        pressChip(tree, UNREAD_TAG_ADS)
        expect(triage.tagFilter).toBe(UNREAD_TAG_ADS)

        // One ad archived: still ads left, stay.
        messages = { ...messages, 'project-1/chat-emails': [AD_2, NEWS] }
        rerender()
        expect(triage.tagFilter).toBe(UNREAD_TAG_ADS)

        // The last ad archived: nothing after "Ads" has messages, so it wraps to the first one that
        // does, "From people" (before "Newsletters" in the chip order). The project context stays.
        messages = { ...messages, 'project-1/chat-emails': [NEWS] }
        rerender()
        expect(triage.tagFilter).toBe(UNREAD_TAG_PEOPLE)
        expect(showsEmptyState(tree)).toBe(false)

        // People read: on to Newsletters.
        messages = { ...messages, 'project-2/chat-task': [] }
        rerender()
        expect(triage.tagFilter).toBe(UNREAD_TAG_NEWSLETTER)
        expect(chipTags(tree)).toEqual(['unread-tag-newsletter'])

        // The last message read: no tag left, the tag's empty state shows (the Chats-level flows
        // then leave Unread or open the tasks).
        messages = { ...messages, 'project-1/chat-emails': [] }
        rerender()
        expect(triage.tagFilter).toBe(UNREAD_TAG_NEWSLETTER)
        expect(showsEmptyState(tree)).toBe(true)
    })

    it('waits while a project is still loading its messages', () => {
        const { tree, rerender } = renderView()
        pressChip(tree, UNREAD_TAG_ADS)

        loaded = { 'project-2/chat-task': false }
        messages = { ...messages, 'project-1/chat-emails': [NEWS], 'project-2/chat-task': [] }
        rerender()
        expect(triage.tagFilter).toBe(UNREAD_TAG_ADS)

        loaded = {}
        messages = { ...messages, 'project-2/chat-task': [PERSON] }
        rerender()
        expect(triage.tagFilter).toBe(UNREAD_TAG_PEOPLE)
    })
})

// The global "Nothing unread with this tag" state is on screen.
function showsEmptyState(tree) {
    return tree.root.findAll(node => node.props.testID === 'unread-tag-empty').length > 0
}
