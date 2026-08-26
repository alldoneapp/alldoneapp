/**
 * @jest-environment jsdom
 *
 * AT-2444 — the assistant-project input line takes dropped files too.
 *
 * This line is the assistant profile board's composer. It was a plain React Native `TextInput`,
 * which cannot hold an embed at all, so supporting a drop meant swapping it for the same
 * `CustomTextInput3` the My Day line uses. These tests pin the parts of that swap that are easy
 * to get wrong and silent when wrong: the drop reaches the editor from anywhere on the card, the
 * upload runs before the topic is created, and — because the rich editor is UNCONTROLLED, unlike
 * the `value={message}` TextInput it replaced — the editor is explicitly cleared after a send.
 *
 * Driven through react-dom against the REAL `AttachmentDropZone` with a REAL `drop` event, for
 * the same reason as the My Day suite: a hand-called `props.onDrop` only proves a prop exists.
 */
jest.mock('react-native', () => jest.requireActual('react-native-web'))

let mockState = { smallScreenNavigation: false }

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))

jest.mock('../../../../i18n/TranslationService', () => ({
    translate: key => key,
    getDeviceLanguage: () => 'en',
}))

jest.mock('../../../Premium/PremiumHelper', () => ({ checkIsLimitedByTraffic: jest.fn(() => false) }))

jest.mock('../../../Feeds/CommentsTextInput/textInputHelper', () => ({
    TASK_THEME: 'TASK_THEME',
    insertFilesAsAttachments: jest.fn(() => ({ addedFiles: [], nextCursorIndex: 0 })),
}))

jest.mock('../../../Feeds/Utils/HelperFunctions', () => ({
    updateNewAttachmentsData: jest.fn(async (projectId, text) => text),
}))

jest.mock('../../../../utils/assistantHelper', () => ({
    createBotQuickTopic: jest.fn(async () => ({ projectId: 'project-1', chatId: 'chat-1' })),
}))

jest.mock('../../../UIComponents/Spinner', () => () => null)
jest.mock('../../../UIComponents/AssistantVoiceCallButton', () => () => null)

jest.mock('../../../MyDayView/AssistantLine/AssistantOptions/AssistantAvatarButton', () => {
    const React = require('react')
    const { View } = require('react-native')
    return () => <View testID="assistant-avatar-stub" />
})

jest.mock('../../../UIControls/Button', () => {
    const React = require('react')
    return ({ onPress, disabled, accessibilityLabel }) => (
        <button data-testid="assistant-send-button" onClick={onPress} disabled={!!disabled}>
            {accessibilityLabel}
        </button>
    )
})

var mockEditor
var mockInputProps
var mockClear
// Enter-to-send is a document-level listener gated on `isFocused()`, so a stub that always
// reports "not focused" would make every keyboard assertion below pass vacuously.
var mockIsFocused

jest.mock('../../../Feeds/CommentsTextInput/CustomTextInput3', () => {
    const React = require('react')
    return React.forwardRef((props, ref) => {
        mockInputProps = props
        React.useImperativeHandle(ref, () => ({
            clear: mockClear,
            blur: jest.fn(),
            isFocused: () => mockIsFocused,
        }))
        React.useEffect(() => {
            props.setEditor?.(mockEditor)
        }, [])
        return <input data-testid="assistant-text-input" readOnly value="" />
    })
})

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

import AssistantInputLine from './AssistantInputLine'
import { insertFilesAsAttachments } from '../../../Feeds/CommentsTextInput/textInputHelper'
import { updateNewAttachmentsData } from '../../../Feeds/Utils/HelperFunctions'
import { createBotQuickTopic } from '../../../../utils/assistantHelper'
import { checkIsLimitedByTraffic } from '../../../Premium/PremiumHelper'

const IMAGE_TRIGGER = 'O2TI5plHBf1QfdY'
const imageMessage = `${IMAGE_TRIGGER}blob:shot.png${IMAGE_TRIGGER}blob:shot.png${IMAGE_TRIGGER}shot.png${IMAGE_TRIGGER}1`
const uploadedImageMessage = `${IMAGE_TRIGGER}https://cdn/full.png${IMAGE_TRIGGER}https://cdn/small.png${IMAGE_TRIGGER}shot.png${IMAGE_TRIGGER}0`

const imageFile = (name = 'shot.png') => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })
const assistant = { uid: 'assistant-1', displayName: 'Assistant' }

describe('dragging a file onto the assistant-project input line (AT-2444)', () => {
    let container
    let root

    beforeAll(() => {
        global.IS_REACT_ACT_ENVIRONMENT = true
    })

    beforeEach(async () => {
        jest.clearAllMocks()
        mockState = { smallScreenNavigation: false }
        checkIsLimitedByTraffic.mockReturnValue(false)
        insertFilesAsAttachments.mockReturnValue({ addedFiles: [imageFile()], nextCursorIndex: 3 })
        updateNewAttachmentsData.mockImplementation(async (projectId, text) => text)
        createBotQuickTopic.mockResolvedValue({ projectId: 'project-1', chatId: 'chat-1' })
        mockEditor = { focus: jest.fn(), getLength: () => 1 }
        mockInputProps = null
        mockClear = jest.fn()
        mockIsFocused = true

        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)

        await act(async () => {
            root.render(<AssistantInputLine assistant={assistant} projectId={'project-1'} />)
        })
    })

    afterEach(() => {
        act(() => root.unmount())
        document.body.innerHTML = ''
    })

    const dropOn = (selector, files) => {
        const node = container.querySelector(selector)
        expect(node).toBeTruthy()

        const event = new Event('drop', { bubbles: true, cancelable: true })
        event.dataTransfer = { files, types: files.length ? ['Files'] : [], dropEffect: 'none' }
        act(() => {
            node.dispatchEvent(event)
        })
        return event
    }

    const typeMessage = async text => {
        await act(async () => {
            mockInputProps.onChangeText(text)
        })
    }

    const pressSend = async () => {
        await act(async () => {
            container.querySelector('[data-testid="assistant-send-button"]').click()
        })
    }

    it('inserts a file dropped on the card, away from the field', () => {
        const file = imageFile()
        dropOn('[data-testid="assistant-avatar-stub"]', [file])

        expect(insertFilesAsAttachments).toHaveBeenCalledTimes(1)
        expect(insertFilesAsAttachments).toHaveBeenCalledWith(
            expect.objectContaining({ files: [file], editor: mockEditor })
        )
    })

    it('claims the drop so the browser does not navigate away to the file', () => {
        const event = dropOn('[data-testid="assistant-avatar-stub"]', [imageFile()])
        expect(event.defaultPrevented).toBe(true)
    })

    it('accepts any supported file, not only images', () => {
        const pdf = new File([new Uint8Array([1])], 'report.pdf', { type: 'application/pdf' })
        dropOn('[data-testid="assistant-avatar-stub"]', [pdf])

        expect(insertFilesAsAttachments).toHaveBeenCalledWith(expect.objectContaining({ files: [pdf] }))
    })

    it('inserts nothing when the project is over its traffic quota', () => {
        checkIsLimitedByTraffic.mockReturnValue(true)
        dropOn('[data-testid="assistant-avatar-stub"]', [imageFile()])

        expect(insertFilesAsAttachments).not.toHaveBeenCalled()
    })

    it('ignores a drag carrying no files', () => {
        const event = dropOn('[data-testid="assistant-text-input"]', [])

        expect(insertFilesAsAttachments).not.toHaveBeenCalled()
        expect(event.defaultPrevented).toBe(false)
    })

    it('declares the attachment formats, which is also what enables paste', () => {
        expect(mockInputProps.otherFormats).toEqual(
            expect.arrayContaining(['image', 'attachment', 'customImageFormat', 'videoFormat'])
        )
    })

    it('uploads the attachment before creating the topic and sends the rewritten text', async () => {
        updateNewAttachmentsData.mockResolvedValue(uploadedImageMessage)
        await typeMessage(imageMessage)
        await pressSend()

        expect(updateNewAttachmentsData).toHaveBeenCalledWith('project-1', imageMessage)
        expect(createBotQuickTopic).toHaveBeenCalledWith(
            assistant,
            uploadedImageMessage,
            expect.objectContaining({ projectId: 'project-1' })
        )
        expect(createBotQuickTopic.mock.calls[0][1]).not.toContain('blob:')
    })

    it('uploads before creating the topic, never after', async () => {
        const order = []
        updateNewAttachmentsData.mockImplementation(async (projectId, text) => {
            order.push('upload')
            return text
        })
        createBotQuickTopic.mockImplementation(async () => {
            order.push('createTopic')
            return { projectId: 'project-1', chatId: 'chat-1' }
        })

        await typeMessage(imageMessage)
        await pressSend()

        expect(order).toEqual(['upload', 'createTopic'])
    })

    it('clears the editor after sending — the rich editor is uncontrolled', async () => {
        await typeMessage('Hello there')
        await pressSend()

        expect(mockClear).toHaveBeenCalled()
    })

    it('lets an image be sent on its own, with no typed prose', async () => {
        await typeMessage(imageMessage)
        expect(container.querySelector('[data-testid="assistant-send-button"]').disabled).toBe(false)

        await pressSend()
        expect(createBotQuickTopic).toHaveBeenCalledTimes(1)
    })

    it('keeps the send button disabled while the composer is empty', () => {
        expect(container.querySelector('[data-testid="assistant-send-button"]').disabled).toBe(true)
    })

    it('still sends a plain text message unchanged', async () => {
        await typeMessage('Summarise my open tasks')
        await pressSend()

        expect(createBotQuickTopic).toHaveBeenCalledWith(
            assistant,
            'Summarise my open tasks',
            expect.objectContaining({ projectId: 'project-1' })
        )
    })

    it('raises the composer height cap only while it holds media', async () => {
        expect(mockInputProps.maxHeight).toBe(120)

        await typeMessage(imageMessage)
        expect(mockInputProps.maxHeight).toBe(260)

        await typeMessage('just words now')
        expect(mockInputProps.maxHeight).toBe(120)
    })

    const pressEnter = async () => {
        await act(async () => {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
        })
    }

    it('sends on Enter, replacing the TextInput onKeyPress the swap removed', async () => {
        await typeMessage('Summarise my open tasks')
        await pressEnter()

        expect(createBotQuickTopic).toHaveBeenCalledTimes(1)
    })

    it('leaves Enter to the mentions dropdown so picking a mention does not send', async () => {
        await typeMessage('Hi @col')
        await act(async () => {
            mockInputProps.setMentionsModalActive(true)
        })
        await pressEnter()

        expect(createBotQuickTopic).not.toHaveBeenCalled()

        // ...and once the dropdown is gone the very same keystroke sends.
        await act(async () => {
            mockInputProps.setMentionsModalActive(false)
        })
        await pressEnter()

        expect(createBotQuickTopic).toHaveBeenCalledTimes(1)
    })

    it('does not send on Enter while the editor is not focused', async () => {
        await typeMessage('Summarise my open tasks')
        mockIsFocused = false
        await pressEnter()

        expect(createBotQuickTopic).not.toHaveBeenCalled()
    })
})
