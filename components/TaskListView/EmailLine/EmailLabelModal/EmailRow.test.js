/**
 * @jest-environment jsdom
 */

import React from 'react'
import { TouchableOpacity } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import EmailRow from './EmailRow'
import { openUrlInNewTab } from '../emailLineHelper'
import URLTrigger from '../../../../URLSystem/URLTrigger'

jest.mock('react-redux', () => ({ useSelector: jest.fn(selector => selector({ smallScreen: false })) }))
jest.mock('../../../../i18n/TranslationService', () => ({ translate: jest.fn(key => key) }))
jest.mock('../emailLineHelper', () => ({ openUrlInNewTab: jest.fn() }))
jest.mock('./DraftReplyPopup', () => () => null)
// The backend transitively imports the redux store (and react-hot-keys), which jest
// cannot transform.
jest.mock('../../../../utils/backends/EmailLine/emailLineBackend', () => ({
    submitEmailLabelFeedback: jest.fn(),
    performEmailLineAction: jest.fn(),
}))
// URLTrigger transitively imports the redux store as well.
jest.mock('../../../../URLSystem/URLTrigger', () => ({ __esModule: true, default: { processUrl: jest.fn() } }))
jest.mock('../../../../utils/NavigationService', () => ({ __esModule: true, default: {} }))
jest.mock('../../../../utils/LinkingHelper', () => ({
    getDvMainTabLink: jest.fn((projectId, objectId) => `/projects/${projectId}/tasks/${objectId}/properties`),
}))

const findByLabel = (tree, label) =>
    tree.root.findAll(node => node.type === TouchableOpacity && node.props.accessibilityLabel === label)

describe('EmailRow', () => {
    beforeEach(() => jest.clearAllMocks())

    it('opens the https unsubscribe link', () => {
        const row = {
            messageId: 'm1',
            from: 'News <news@ex.com>',
            subject: 'Sale',
            unsubscribe: { httpsUrl: 'https://ex.com/u', mailto: 'mailto:u@ex.com' },
        }
        let tree
        act(() => {
            tree = renderer.create(<EmailRow row={row} connectionId="c1" selected={false} />)
        })
        const [unsub] = findByLabel(tree, 'Unsubscribe')
        act(() => unsub.props.onPress())
        expect(openUrlInNewTab).toHaveBeenCalledWith('https://ex.com/u')
    })

    it('falls back to the message url for mailto-only unsubscribe', () => {
        const row = {
            messageId: 'm1',
            from: 'news@ex.com',
            subject: 'Sale',
            webUrl: 'https://mail/m1',
            unsubscribe: { mailto: 'mailto:u@ex.com' },
        }
        let tree
        act(() => {
            tree = renderer.create(<EmailRow row={row} connectionId="c1" selected={false} />)
        })
        const [unsub] = findByLabel(tree, 'Unsubscribe')
        act(() => unsub.props.onPress())
        expect(openUrlInNewTab).toHaveBeenCalledWith('https://mail/m1')
    })

    it('renders no unsubscribe affordance without header data', () => {
        const row = { messageId: 'm1', from: 'a@ex.com', subject: 'Hi', unsubscribe: null }
        let tree
        act(() => {
            tree = renderer.create(<EmailRow row={row} connectionId="c1" selected={false} />)
        })
        expect(findByLabel(tree, 'Unsubscribe')).toHaveLength(0)
    })

    it('shows a visible reason action and sends wrong-label feedback', async () => {
        const { submitEmailLabelFeedback } = require('../../../../utils/backends/EmailLine/emailLineBackend')
        submitEmailLabelFeedback.mockResolvedValue({ learnedRules: '- rule' })
        const row = {
            messageId: 'm1',
            from: 'a@ex.com',
            subject: 'Hi',
            reasoning: 'Weekly digest the user subscribed to.',
            labelName: 'Alldone/Newsletter',
            confidence: 0.9,
        }
        let tree
        act(() => {
            tree = renderer.create(
                <EmailRow
                    row={row}
                    connectionId="c1"
                    labelOptions={[
                        { labelId: 'L_ads', displayName: 'Ads' },
                        { labelId: 'L_news', displayName: 'Alldone/Newsletter' },
                        { labelId: 'L_book', displayName: 'Bookkeeping' },
                    ]}
                    currentLabelId="L_news"
                    selected={false}
                />
            )
        })

        const [toggle] = findByLabel(tree, 'Why this label')
        act(() => toggle.props.onPress())

        const texts = tree.root.findAll(node => typeof node.props.children === 'string').map(n => n.props.children)
        expect(texts).toContain('Weekly digest the user subscribed to.')
        expect(texts).toContain('Alldone/Newsletter · 90%')

        const [wrong] = findByLabel(tree, 'Wrong label?')
        act(() => wrong.props.onPress())

        const [selectLabel] = findByLabel(tree, 'Select correct label')
        act(() => selectLabel.props.onPress())

        const optionTexts = tree.root
            .findAll(node => typeof node.props.children === 'string')
            .map(n => n.props.children)
        expect(optionTexts).toContain('Inbox only')
        expect(optionTexts).toContain('Ads')
        expect(optionTexts).toContain('Bookkeeping')

        const [adsOption] = findByLabel(tree, 'Correct label: Ads')
        act(() => adsOption.props.onPress())

        // Ancestor touchables (the row content) also contain the text — take the innermost.
        const send = tree.root
            .findAll(node => node.type === TouchableOpacity)
            .filter(node => node.findAll(child => child.props.children === 'Send feedback').length > 0)
            .pop()
        await act(async () => {
            send.props.onPress()
            await Promise.resolve()
        })

        expect(submitEmailLabelFeedback).toHaveBeenCalledWith('c1', {
            messageId: 'm1',
            correctLabel: 'Ads',
            correctLabelId: 'L_ads',
            currentLabelId: 'L_news',
            note: '',
        })
        const doneTexts = tree.root.findAll(node => typeof node.props.children === 'string').map(n => n.props.children)
        expect(doneTexts).toContain('Labeling instructions updated')
    })

    it('keeps the reason action visible when no explanation was recorded', () => {
        const row = {
            messageId: 'm1',
            from: 'a@ex.com',
            subject: 'Hi',
        }
        let tree
        act(() => {
            tree = renderer.create(<EmailRow row={row} connectionId="c1" selected={false} />)
        })

        const [toggle] = findByLabel(tree, 'Why this label')
        act(() => toggle.props.onPress())

        const texts = tree.root.findAll(node => typeof node.props.children === 'string').map(n => n.props.children)
        expect(texts).toContain('No project or label explanation was recorded for this email.')
        expect(findByLabel(tree, 'Wrong label?')).toHaveLength(0)
    })

    it('sends null feedback when Inbox only is selected', async () => {
        const { submitEmailLabelFeedback } = require('../../../../utils/backends/EmailLine/emailLineBackend')
        submitEmailLabelFeedback.mockResolvedValue({ learnedRules: '- rule' })
        const row = {
            messageId: 'm1',
            from: 'a@ex.com',
            subject: 'Hi',
            reasoning: 'This looked like a newsletter.',
            labelName: 'Ads',
        }
        let tree
        act(() => {
            tree = renderer.create(
                <EmailRow
                    row={row}
                    connectionId="c1"
                    labelOptions={[{ labelId: 'L_ads', displayName: 'Ads' }]}
                    currentLabelId="L_ads"
                    selected={false}
                />
            )
        })

        act(() => findByLabel(tree, 'Why this label')[0].props.onPress())
        act(() => findByLabel(tree, 'Wrong label?')[0].props.onPress())
        act(() => findByLabel(tree, 'Select correct label')[0].props.onPress())
        act(() => findByLabel(tree, 'Correct label: Inbox only')[0].props.onPress())

        const send = tree.root
            .findAll(node => node.type === TouchableOpacity)
            .filter(node => node.findAll(child => child.props.children === 'Send feedback').length > 0)
            .pop()
        await act(async () => {
            send.props.onPress()
            await Promise.resolve()
        })

        expect(submitEmailLabelFeedback).toHaveBeenCalledWith('c1', {
            messageId: 'm1',
            correctLabel: null,
            correctLabelId: null,
            currentLabelId: 'L_ads',
            note: '',
        })
    })

    it('creates a task and turns the + button into a link to it', async () => {
        const { performEmailLineAction } = require('../../../../utils/backends/EmailLine/emailLineBackend')
        performEmailLineAction.mockResolvedValue({ taskId: 't1', projectId: 'p9' })
        const row = { messageId: 'm1', messageIds: ['m1', 'm2'], from: 'a@ex.com', subject: 'Hi' }
        let tree
        act(() => {
            tree = renderer.create(<EmailRow row={row} connectionId="c1" selected={false} />)
        })

        const [create] = findByLabel(tree, 'Create task')
        await act(async () => {
            create.props.onPress()
            await Promise.resolve()
        })

        expect(performEmailLineAction).toHaveBeenCalledWith('c1', { action: 'createTask', messageIds: ['m1', 'm2'] })
        const [done] = findByLabel(tree, 'Task created')
        act(() => done.props.onPress())
        expect(URLTrigger.processUrl).toHaveBeenCalledWith(expect.anything(), '/projects/p9/tasks/t1/properties')
    })

    it('starts in the created state when the server says a task already exists', () => {
        const row = { messageId: 'm1', from: 'a@ex.com', subject: 'Hi', taskCreated: { taskId: 't1', projectId: 'p9' } }
        let tree
        act(() => {
            tree = renderer.create(<EmailRow row={row} connectionId="c1" selected={false} />)
        })
        expect(findByLabel(tree, 'Create task')).toHaveLength(0)
        const [done] = findByLabel(tree, 'Task created')
        act(() => done.props.onPress())
        expect(URLTrigger.processUrl).toHaveBeenCalledWith(expect.anything(), '/projects/p9/tasks/t1/properties')
    })
})
