import React, { act } from 'react'
import { TouchableOpacity } from 'react-native'
import { createRoot } from 'react-dom/client'

import TaskTagTitle, { parseTaskTagTitle } from './TaskTagTitle'

const mockInlineAction = jest.fn()
jest.mock('../Feeds/Utils/HelperFunctions', () => ({
    ...jest.requireActual('../Feeds/Utils/feedCommentParser'),
    tryToextractPeopleForMention: () => null,
}))
jest.mock('../TaskListView/Utils/TasksHelper', () => ({
    __esModule: true,
    default: {
        getDataFromMention: (text, projectId) => {
            const { mentionText, userId } = require('../../functions/Utils/parseTextUtils').getMentionData(`@${text}`)
            return { mention: mentionText, user: { uid: userId, projectId } }
        },
    },
}))
jest.mock('../Feeds/CommentsTextInput/textInputHelper', () => ({
    getKarmaData: text => ({ userId: text.split('pMP4SB2IsTQr8LN')[1] }),
}))
jest.mock('./LinkTag', () => ({ link, projectId }) => (
    <a
        href={link}
        data-project={projectId}
        onClick={event => {
            event.preventDefault()
            mockInlineAction(link)
        }}
    >
        Link
    </a>
))
jest.mock('./EmailTag', () => ({ address }) => (
    <a href={`mailto:${address}`} onClick={event => event.preventDefault()}>
        Email
    </a>
))
jest.mock('./HashTag', () => ({ text, projectId }) => (
    <button data-project={projectId} onClick={() => mockInlineAction(text)}>
        #{text}
    </button>
))
jest.mock('./MentionTag', () => ({ text, user, projectId }) => (
    <button data-user={user.uid} data-project={projectId} onClick={() => mockInlineAction(user.uid)}>
        @{text}
    </button>
))
jest.mock('./FileDownloadableTag', () => {
    const React = require('react')
    const { TouchableOpacity, Text } = require('react-native')
    return ({ uri, text }) => (
        <TouchableOpacity accessibilityLabel={text} onPress={() => mockInlineAction(uri)}>
            <Text>{text}</Text>
        </TouchableOpacity>
    )
})
jest.mock('./KarmaTag', () => ({ userId }) => <span data-user={userId}>Karma</span>)
jest.mock('./MentionedCommentTag', () => 'MentionedCommentTag')

const screenshotLink =
    'https://my.alldone.app/projects/-Ona1ph4uu0mdSl9zizI/preConfigTasks/-Oq7EYyF6kdWstuBB9IL/run?assistantId=assistant-1&name=Update'
const attachment = uri => 'EbDsQTD14ahtSR5' + [uri, 'Plan.pdf', '0'].join('EbDsQTD14ahtSR5')
const media = (trigger, parts) => trigger + parts.join(trigger)

let root
let container
let mockTaskPress
const previousActEnvironment = global.IS_REACT_ACT_ENVIRONMENT

beforeEach(() => {
    jest.clearAllMocks()
    global.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    mockTaskPress = jest.fn()
})
afterEach(() => {
    act(() => root.unmount())
    container.remove()
    global.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

const render = (text, disabled = false) =>
    act(() =>
        root.render(
            <TouchableOpacity onPress={mockTaskPress}>
                <span data-testid="checkbox">□</span>
                <TaskTagTitle text={text} projectId="project-1" disabled={disabled} />
            </TouchableOpacity>
        )
    )
const click = element => act(() => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })))

it('renders the screenshot destination as a link without losing its query string', () => {
    render(`Update ${screenshotLink}`)
    expect(container.querySelector('a').getAttribute('href')).toBe(screenshotLink)
    click(container.querySelector('a'))
    expect(mockInlineAction).toHaveBeenCalledWith(screenshotLink)
    expect(mockTaskPress).not.toHaveBeenCalled()
})

it('keeps checkbox and ordinary title clicks opening the task menu', () => {
    render(`Update ${screenshotLink}`)
    click(container.querySelector('[data-testid="checkbox"]'))
    const plainWord = [...container.querySelectorAll('div')].find(element => element.textContent === 'Update')
    click(plainWord)
    expect(mockTaskPress).toHaveBeenCalledTimes(2)
})

it('uses existing email, hashtag and mention rendering with original mention IDs', () => {
    render('Discuss mail@example.com #release @KarstenM2mVOSjAVPPKweLWysk#user-1')
    expect(container.querySelector('a').getAttribute('href')).toBe('mailto:mail@example.com')
    expect(container.querySelector('[data-user]').textContent).toBe('@Karsten Wysk')
    expect(container.querySelector('[data-user]').getAttribute('data-user')).toBe('user-1')
    expect(container.querySelector('[data-user]').getAttribute('data-project')).toBe('project-1')
    click(container.querySelector('button'))
    click(container.querySelector('[data-user]'))
    click(container.querySelector('a'))
    expect(mockInlineAction.mock.calls).toEqual([['release'], ['user-1']])
    expect(mockTaskPress).not.toHaveBeenCalled()
})

it.each([
    attachment('https://example.com/Plan.pdf'),
    media('O2TI5plHBf1QfdY', ['https://example.com/photo.png', 'https://example.com/small.png', 'Photo.png', '0']),
    media('ptPQsef7OeB5eWd', ['https://example.com/movie.mp4', 'Movie.mp4', '0']),
])('renders media as the established download tag and isolates its RN press (%s)', text => {
    render(text)
    click(container.querySelector('[aria-label]'))
    expect(mockInlineAction).toHaveBeenCalledTimes(1)
    expect(mockTaskPress).not.toHaveBeenCalled()
})

it.each([
    screenshotLink,
    '#release',
    '@Karsten#user-1',
    'mail@example.com',
    attachment('https://example.com/file.pdf'),
])('blocks inline actions in a disabled task chip (%s)', text => {
    render(text, true)
    const target = container.querySelector('a, button, [aria-label]')
    click(target)
    act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    act(() => target.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true })))
    expect(mockInlineAction).not.toHaveBeenCalled()
    expect(mockTaskPress).not.toHaveBeenCalled()
})

it('keeps keyboard activation inside an inline tag from reaching the task button', () => {
    render(attachment('https://example.com/file.pdf'))
    const target = container.querySelector('[aria-label]')
    act(() => target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })))
    act(() => target.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true })))
    expect(mockInlineAction).toHaveBeenCalledTimes(1)
    expect(mockTaskPress).not.toHaveBeenCalled()
})

it('updates destinations when the live task title changes', () => {
    render('https://example.com/old')
    render('https://example.com/new?revision=2')
    expect(container.querySelector('a').getAttribute('href')).toBe('https://example.com/new?revision=2')
    render('Plain task title')
    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toContain('Plain task title')
})

it('reuses Markdown and punctuation parsing and normalizes bare domains safely', () => {
    expect(
        parseTaskTagTitle('See [release notes](https://example.com/releases?rev=2), (www.example.org/path).').filter(
            word => word.type === 'url'
        )
    ).toEqual([
        { type: 'url', link: 'https://example.com/releases?rev=2' },
        { type: 'url', link: 'https://www.example.org/path' },
    ])
})

it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'file:///etc/passwd',
    'https://',
    'https://example.com:\\bad',
])('does not create an actionable link for an unsafe or malformed destination (%s)', text => {
    render(text)
    expect(container.querySelector('a')).toBeNull()
})

it.each(['javascript:alert(1)', 'data:text/html,alert(1)', 'file:///etc/passwd', 'https://'])(
    'shows readable media text without opening an unsafe destination (%s)',
    uri => {
        render(attachment(uri))
        expect(container.querySelector('[aria-label], a')).toBeNull()
        expect(container.textContent).toContain('Plan.pdf')
    }
)

it('retains readable milestone markers and existing karma tokens', () => {
    render('qM54HU5TsTOe3Yw13.10.2026qM54HU5TsTOe3Ywmilestone-1 pMP4SB2IsTQr8LNuser-1')
    expect(container.textContent).toContain('13.10.2026')
    expect(container.querySelector('[data-user]').getAttribute('data-user')).toBe('user-1')
})
