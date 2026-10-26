import React from 'react'
import { Text } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import LastCommentText from './LastCommentText'
import LastAssistantComment from './LastAssistantComment'
import PendingAssistantComment from './PendingAssistantComment'
import MentionTag from '../../../Tags/MentionTag'
import LinkTag from '../../../Tags/LinkTag'
import { PENDING_SEND_SENDING, PENDING_SEND_AWAITING_REPLY, PENDING_SEND_FAILED } from '../assistantLinePendingSend'
import { resetLastCommentSlotRows } from './lastCommentSlotRow'

const PROJECT_ID = 'project-1'
const CONTACT_ID = '-OmJC51CDRxWQcLe9RqF'
const SPACE = 'M2mVOSjAVPPKweL'
const CONTACT = { uid: CONTACT_ID, displayName: 'Lenny LinkedIn', photoURL50: 'avatar.png' }
const mockState = {
    loggedUser: { uid: 'user-1' },
    projectUsers: { [PROJECT_ID]: [] },
    projectContacts: { [PROJECT_ID]: [CONTACT] },
    loggedUserProjectsMap: { [PROJECT_ID]: { id: PROJECT_ID, globalAssistantIds: [] } },
    projectAssistants: { [PROJECT_ID]: [] },
    globalAssistants: [],
}

// Keep real parseFeedComment / TasksHelper.getDataFromMention / getMentionData. Replace the
// application store, backend and interactive leaf tags so these tests need no Firebase session.
jest.mock('../../../../redux/store', () => ({
    __esModule: true,
    default: { getState: () => mockState, dispatch: jest.fn(), subscribe: () => () => {} },
}))
jest.mock('../../../../utils/BackendBridge', () => ({}))
jest.mock('../../../../utils/InitialLoad/projectDataLoader', () => ({ requestProjectDataOnLookupMiss: jest.fn() }))
jest.mock('react-native-gesture-handler', () => require('react-native'))
jest.mock('react-redux', () => ({
    ...jest.requireActual('react-redux'),
    useSelector: selector => selector(mockState),
}))
jest.mock('../../../UIComponents/Ghosts/ghostAnimation', () => ({ useReducedMotion: () => true }))
jest.mock('./ProjectTagIndicator', () => () => null)
jest.mock('./UnreadCommentsBadge', () => () => null)
jest.mock('../../../Tags/MentionTag', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return ({ text }) => <Text>{text} </Text>
})
jest.mock('../../../Tags/LinkTag', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return ({ link }) => <Text>{link.startsWith('https://alldone.app/') ? 'Object label' : link} </Text>
})
jest.mock('../../../Tags/HashTag', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return ({ text }) => <Text>#{text}</Text>
})
jest.mock('../../../Tags/EmailTag', () => {
    const React = require('react')
    const { Text } = require('react-native')
    return ({ email }) => <Text>{email} </Text>
})

const textOf = node =>
    node
        .findAllByType(Text)
        .map(text => React.Children.toArray(text.props.children).join(''))
        .join('')
        .trim()

const render = element => {
    let tree
    act(() => {
        tree = renderer.create(element)
    })
    return tree
}

const token = `@Lenny${SPACE}LinkedIn#${CONTACT_ID}`
const comment = `${token} content idea: Rede über Ricky Returns, der dich durch die Finanzierung führt`

const variants = [
    ['pending', false],
    ['pending', true],
    ['saved', false],
    ['saved', true],
]
const preview = (kind, compact, text, status = PENDING_SEND_SENDING) =>
    kind === 'pending' ? (
        <PendingAssistantComment pending={{ id: 'send-1', projectId: PROJECT_ID, text, status }} compact={compact} />
    ) : (
        <LastAssistantComment projectId={PROJECT_ID} commentText={text} compact={compact} />
    )

beforeEach(() => resetLastCommentSlotRows())

describe('Last comment mention previews (AT-2695)', () => {
    it.each(variants)('renders Lenny LinkedIn in %s (compact=%s) without serialized IDs', (kind, compact) => {
        const tree = render(preview(kind, compact, comment))
        const body = tree.root.findByType(LastCommentText)
        const mention = body.findByType(MentionTag)

        expect(mention.props.text).toBe('Lenny LinkedIn')
        expect(mention.props.user).toMatchObject({ uid: CONTACT_ID, peopleName: 'Lenny LinkedIn' })
        expect(mention.props.projectId).toBe(PROJECT_ID)
        expect(textOf(body)).toBe(
            'Lenny LinkedIn content idea: Rede über Ricky Returns, der dich durch die Finanzierung führt'
        )
        expect(textOf(body)).not.toContain(SPACE)
        expect(textOf(body)).not.toContain(CONTACT_ID)
        act(() => tree.unmount())
    })

    it.each([PENDING_SEND_SENDING, PENDING_SEND_AWAITING_REPLY, PENDING_SEND_FAILED])(
        'keeps the readable mention through status %s',
        status => {
            const tree = render(preview('pending', false, comment, status))
            expect(tree.root.findByType(MentionTag).props.text).toBe('Lenny LinkedIn')
            act(() => tree.unmount())
        }
    )

    it.each([
        [`@Lenny${SPACE.toLowerCase()}LinkedIn#${CONTACT_ID}`, 'Lenny LinkedIn'],
        [`${token}###https://cdn.example.com/avatar.png`, 'Lenny LinkedIn'],
        [`@Free${SPACE}mention###https://cdn.example.com/avatar.png`, 'Free mention'],
        [`@Generic${SPACE}object#0`, 'Generic object'],
        ['@Anna#missing-person', 'Anna'],
    ])('supports existing mention representation %s', (text, label) => {
        const tree = render(<LastCommentText projectId={PROJECT_ID} commentText={text} />)
        expect(tree.root.findByType(MentionTag).props.text).toBe(label)
        expect(textOf(tree.root)).toBe(label)
        act(() => tree.unmount())
    })

    it.each(variants)('delegates object URLs to the existing LinkTag in %s (compact=%s)', (kind, compact) => {
        const url = 'https://alldone.app/projects/project-1/tasks/task-123/properties'
        const tree = render(preview(kind, compact, `Bitte ${url} prüfen.`))
        const body = tree.root.findByType(LastCommentText)
        expect(body.findByType(LinkTag).props.link).toBe(url)
        expect(body.findByType(LinkTag).props.projectId).toBe(PROJECT_ID)
        expect(textOf(body)).not.toContain('task-123')
        expect(textOf(body)).toContain('Bitte ')
        expect(textOf(body)).toContain('prüfen.')
        act(() => tree.unmount())
    })

    it('renders contact URLs as mentions through the existing people lookup', () => {
        const url = `https://alldone.app/projects/${PROJECT_ID}/contacts/${CONTACT_ID}/properties`
        const tree = render(<LastCommentText projectId={PROJECT_ID} commentText={`Bitte ${url} fragen.`} />)
        expect(tree.root.findByType(MentionTag).props.text).toBe('Lenny LinkedIn')
        expect(tree.root.findByType(MentionTag).props.user.uid).toBe(CONTACT_ID)
        expect(tree.root.findAllByType(LinkTag)).toHaveLength(0)
        expect(textOf(tree.root)).not.toContain(CONTACT_ID)
        act(() => tree.unmount())
    })

    it('preserves normal text, punctuation, Unicode, email and adjacent mentions', () => {
        const tree = render(
            <LastCommentText
                projectId={PROJECT_ID}
                commentText={`Grüße 👋\n${token}\t@Generic${SPACE}object#0 bitte a@example.com fragen: #Idee!`}
            />
        )
        const body = tree.root
        expect(body.findAllByType(MentionTag).map(tag => tag.props.text)).toEqual(['Lenny LinkedIn', 'Generic object'])
        expect(textOf(body)).toBe('Grüße 👋 Lenny LinkedIn Generic object bitte a@example.com fragen: #Idee!')
        act(() => tree.unmount())
    })

    it('preserves a plain comment including punctuation and Unicode', () => {
        const tree = render(
            <LastCommentText projectId={PROJECT_ID} commentText="Rede über Ricky Returns – Grüße 👋!" />
        )
        expect(textOf(tree.root)).toBe('Rede über Ricky Returns – Grüße 👋!')
        act(() => tree.unmount())
    })

    it('never truncates inside mention metadata near the preview limit', () => {
        const tree = render(
            <LastCommentText projectId={PROJECT_ID} commentText={`${'a'.repeat(480)} ${token} after`} />
        )
        expect(tree.root.findByType(MentionTag).props.text).toBe('Lenny LinkedIn')
        expect(tree.root.findByType(MentionTag).props.user.uid).toBe(CONTACT_ID)
        expect(textOf(tree.root)).not.toContain('M2mVOS')
        expect(textOf(tree.root)).not.toContain(CONTACT_ID)
        act(() => tree.unmount())
    })

    it('keeps attachment labels readable in the actual pending card', () => {
        const trigger = 'EbDsQTD14ahtSR5'
        const attachment = `${trigger}blob:http://localhost/file${trigger}screenshot.png${trigger}true`
        const tree = render(preview('pending', false, `Bitte ${attachment} prüfen.`))
        const body = tree.root.findByType(LastCommentText)
        expect(textOf(body)).toBe('Bitte screenshot.png prüfen.')
        expect(textOf(body)).not.toContain(trigger)
        expect(textOf(body)).not.toContain('blob:')
        act(() => tree.unmount())
    })

    it('keeps empty comments empty', () => {
        const tree = render(<LastCommentText projectId={PROJECT_ID} />)
        expect(textOf(tree.root)).toBe('')
        act(() => tree.unmount())
    })
})
