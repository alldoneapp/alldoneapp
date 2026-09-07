import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text, TouchableOpacity } from 'react-native'

const mockRespond = jest.fn(() => Promise.resolve({ status: 'approved' }))
let watchCallback = null

jest.mock('../../../../utils/backends/Assistants/browserApprovals', () => ({
    watchBrowserApprovals: (projectId, objectId, userId, callback) => {
        watchCallback = callback
        return () => {
            watchCallback = null
        }
    },
    respondToBrowserApproval: (...args) => mockRespond(...args),
}))

jest.mock('react-redux', () => ({
    useSelector: selector => selector({ loggedUser: { uid: 'user1' } }),
}))

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
}))

jest.mock('./BrowserTakeoverPanel', () => 'BrowserTakeoverPanel')

const BrowserApprovalCard = require('./BrowserApprovalCard').default

function approval(overrides = {}) {
    return {
        approvalId: 'bapr_1',
        assistantCommentId: 'comment1',
        category: 'booking',
        message: 'This would make a booking on tickets.example.',
        hostname: 'tickets.example',
        target: { name: 'Jetzt buchen', role: 'button' },
        allowRunScope: true,
        ...overrides,
    }
}

function render(props = {}) {
    let tree
    act(() => {
        tree = renderer.create(<BrowserApprovalCard projectId="p1" objectId="task1" commentId="comment1" {...props} />)
    })
    return tree
}

function publish(tree, approvals) {
    act(() => {
        watchCallback(approvals)
    })
    return tree
}

function textsOf(tree) {
    const texts = []
    for (const node of tree.root.findAllByType(Text)) {
        const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children]
        const joined = children.filter(child => typeof child === 'string').join('')
        if (joined) texts.push(joined)
    }
    return texts
}

function pressLabelled(tree, label) {
    const button = tree.root
        .findAllByType(TouchableOpacity)
        .find(node => node.findAllByType(Text).some(text => text.props.children === label))
    if (!button) throw new Error(`No button labelled ${label}`)
    return button.props.onPress()
}

describe('BrowserApprovalCard', () => {
    beforeEach(() => {
        mockRespond.mockClear()
        watchCallback = null
    })

    it('renders nothing until something is actually pending', () => {
        const tree = render()
        expect(tree.toJSON()).toBeNull()
    })

    it('shows what would happen, on which host, and the three answers', () => {
        const tree = publish(render(), [approval()])
        const labels = textsOf(tree)

        expect(labels).toEqual(expect.arrayContaining(['browser_approval_allow_once', 'browser_approval_deny']))
        expect(labels.some(label => label.includes('Jetzt buchen'))).toBe(true)
        expect(labels).toContain('This would make a booking on tickets.example.')
    })

    it('offers "for this run" ONLY when the policy allowed it for the category', () => {
        // A payment, a login, a deletion and an upload are each their own irreversible act; "yes,
        // and stop asking" must not be reachable for them.
        const allowed = publish(render(), [approval({ allowRunScope: true })])
        expect(textsOf(allowed)).toContain('browser_approval_allow_run')

        const refused = publish(render(), [approval({ category: 'payment', allowRunScope: false })])
        expect(textsOf(refused)).not.toContain('browser_approval_allow_run')
    })

    it('routes login approvals into secure human takeover instead of letting the assistant type credentials', () => {
        const tree = publish(render(), [approval({ category: 'login', allowRunScope: false })])

        expect(textsOf(tree)).toContain('browser_takeover_start')
        expect(textsOf(tree)).not.toContain('browser_approval_allow_once')
        act(() => {
            pressLabelled(tree, 'browser_takeover_start')
        })
        expect(tree.root.findByType('BrowserTakeoverPanel').props.approval.approvalId).toBe('bapr_1')
    })

    it('sends the answer with the scope the button stands for', async () => {
        const tree = publish(render(), [approval()])
        await act(async () => {
            pressLabelled(tree, 'browser_approval_allow_run')
        })
        expect(mockRespond).toHaveBeenCalledWith({ approvalId: 'bapr_1', action: 'approve', scope: 'run' })
    })

    it('reports a denial as sticking for the run, not as a one-off', async () => {
        const tree = publish(render(), [approval()])
        await act(async () => {
            pressLabelled(tree, 'browser_approval_deny')
        })
        expect(mockRespond).toHaveBeenCalledWith({ approvalId: 'bapr_1', action: 'deny', scope: undefined })
        expect(textsOf(tree)).toContain('browser_approval_denied')
    })

    it('ignores a request raised for a different comment', () => {
        // A thread can hold more than one browsing run; a card under the wrong comment is a request
        // the user cannot place in the conversation.
        const tree = publish(render(), [approval({ assistantCommentId: 'another-comment' })])
        expect(tree.toJSON()).toBeNull()
    })

    it('surfaces a rejected answer instead of pretending it went through', async () => {
        mockRespond.mockImplementationOnce(() => Promise.reject(new Error('This approval request no longer exists.')))
        const tree = publish(render(), [approval()])
        await act(async () => {
            pressLabelled(tree, 'browser_approval_allow_once')
        })
        expect(textsOf(tree)).toContain('This approval request no longer exists.')
    })
})
