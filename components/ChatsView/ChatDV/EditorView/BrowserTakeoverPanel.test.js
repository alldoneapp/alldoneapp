import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text, TextInput, TouchableOpacity } from 'react-native'

const mockInteract = jest.fn()
const mockFinish = jest.fn()

jest.mock('../../../../utils/backends/Assistants/browserTakeover', () => ({
    interactWithBrowserTakeover: (...args) => mockInteract(...args),
    finishBrowserTakeover: (...args) => mockFinish(...args),
}))

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: (key, params) => (params ? `${key}:${JSON.stringify(params)}` : key),
}))

const BrowserTakeoverPanel = require('./BrowserTakeoverPanel').default

function frame(overrides = {}) {
    return {
        success: true,
        action: 'snapshot',
        screenshotDataUrl: 'data:image/jpeg;base64,anBlZw==',
        viewport: { width: 1280, height: 900 },
        focused: { tagName: 'input', inputType: 'password', name: 'Password' },
        title: 'Sign in',
        goldCost: 1,
        ...overrides,
    }
}

function pressLabelled(tree, label) {
    const button = tree.root
        .findAllByType(TouchableOpacity)
        .find(node => node.findAllByType(Text).some(text => text.props.children === label))
    if (!button) throw new Error(`No button labelled ${label}`)
    return button.props.onPress()
}

describe('BrowserTakeoverPanel', () => {
    beforeEach(() => {
        mockInteract.mockReset()
        mockFinish.mockReset()
        mockInteract.mockResolvedValue(frame())
        mockFinish.mockResolvedValue({ success: true })
    })

    it('opens with one explicit paid snapshot and masks the selected password field', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(<BrowserTakeoverPanel approval={{ approvalId: 'approval1' }} />)
        })

        expect(mockInteract).toHaveBeenCalledWith({ approvalId: 'approval1', action: 'snapshot', input: {} })
        expect(tree.root.findByType(TextInput).props.secureTextEntry).toBe(true)
        expect(JSON.stringify(tree.toJSON())).toContain('browser_takeover_cost')
    })

    it('sends typed credentials only in the takeover request and clears local input afterwards', async () => {
        let tree
        await act(async () => {
            tree = renderer.create(<BrowserTakeoverPanel approval={{ approvalId: 'approval1' }} />)
        })
        mockInteract.mockClear()
        const secret = 'correct horse battery staple'

        act(() => {
            tree.root.findByType(TextInput).props.onChangeText(secret)
        })
        await act(async () => {
            pressLabelled(tree, 'browser_takeover_type')
        })

        expect(mockInteract).toHaveBeenCalledWith({
            approvalId: 'approval1',
            action: 'type',
            input: { text: secret },
        })
        expect(tree.root.findByType(TextInput).props.value).toBe('')
        expect(JSON.stringify(tree.toJSON())).not.toContain(secret)
    })

    it('hands the live session back without persisting it', async () => {
        const onFinished = jest.fn()
        let tree
        await act(async () => {
            tree = renderer.create(
                <BrowserTakeoverPanel approval={{ approvalId: 'approval1' }} onFinished={onFinished} />
            )
        })

        await act(async () => {
            pressLabelled(tree, 'browser_takeover_done')
        })

        expect(mockFinish).toHaveBeenCalledWith({ approvalId: 'approval1', cancelled: false })
        expect(onFinished).toHaveBeenCalled()
    })
})
