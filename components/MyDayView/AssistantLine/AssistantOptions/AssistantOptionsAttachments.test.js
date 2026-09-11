/**
 * @jest-environment jsdom
 *
 * AT-2444 — you can drag an image onto the assistant line.
 *
 * The assistant line's composer had no attachment support of any kind: no `otherFormats`, so
 * `CustomTextInput3.supportsAttachments` was false and `quill.appManagedFileUpload` was never
 * installed (paste dead), no `AttachmentDropZone` (drop dead), and no `updateNewAttachmentsData`
 * on the send path — so even if an embed had reached the editor, it was a `blob:` URL that would
 * never have been uploaded and the assistant would have received a comment with no `mediaContext`.
 *
 * These tests therefore drive the REAL `AttachmentDropZone` inside the REAL `AssistantOptions`
 * through react-dom and dispatch a REAL `drop` event. Two things only a real event can show:
 * that the whole CARD is the target (the drop below lands on the avatar, nowhere near the 40px
 * field), and that the zone is reached at all. Calling `props.onDrop` by hand would assert that
 * a prop exists, which is exactly the shape of test that let AT-2441 through.
 */
jest.mock('react-native', () => jest.requireActual('react-native-web'))

const mockState = {
    selectedProjectIndex: 0,
    loggedUserProjects: [{ id: 'selected-project', index: 0, name: 'Selected project' }],
    defaultAssistant: { uid: 'assistant-1' },
    loggedUser: { uid: 'user-1', defaultProjectId: 'default-project', gold: 100 },
    smallScreenNavigation: false,
    isMiddleScreen: false,
}

jest.mock('react-redux', () => ({
    useDispatch: () => jest.fn(),
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

jest.mock('../../../../utils/backends/Assistants/assistantsFirestore', () => ({
    watchAssistantTasks: jest.fn((projectId, assistantId, watcherKey, callback) => {
        callback([{ id: 'task-1', name: 'Quick task' }])
    }),
}))

jest.mock('../../../../utils/backends/firestore', () => ({
    unwatch: jest.fn(),
    runHttpsCallableFunction: jest.fn(),
}))

jest.mock('../../../../utils/assistantHelper', () => ({
    createBotQuickTopic: jest.fn(async () => ({ projectId: 'selected-project', chatId: 'chat-1' })),
    generateUserIdsToNotifyForNewComments: jest.fn(() => []),
}))

jest.mock('../../../AdminPanel/Assistants/assistantsHelper', () => ({
    GLOBAL_PROJECT_ID: 'globalProject',
    isGlobalAssistant: jest.fn(() => false),
}))

jest.mock('../../../../redux/actions', () => ({
    stopLoadingData: () => ({ type: 'stop' }),
}))

jest.mock('./helper', () => ({
    calculateAmountOfOptionButtons: () => 1,
    getAssistantLineData: () => ({
        assistant: { uid: 'assistant-1', displayName: 'Assistant' },
        assistantProject: { id: 'default-project', index: 1, name: 'Default project' },
        assistantProjectId: 'default-project',
    }),
    getOptionsPresentationData: () => ({
        optionsLikeButtons: [],
        optionsInModal: [],
        showSubmenu: false,
        hasAdditionalOptions: false,
    }),
}))

jest.mock('../../../UIComponents/ModalShell/AppPopover', () => {
    const React = require('react')
    return ({ children }) => <>{children}</>
})

jest.mock('./Search/AssistantTaskSearchButtonWrapper', () => () => null)
jest.mock('./OptionButtons/OptionButtons', () => () => null)
jest.mock('../../../UIComponents/Spinner', () => () => null)
jest.mock('../../../ChatsView/ChatDV/EditorView/BotOption/RunOutOfGoldAssistantModal', () => () => null)
jest.mock('../../../UIComponents/AssistantVoiceCallButton', () => () => null)

// A node that is unmistakably NOT the text field — the drop below is dispatched here.
jest.mock('./AssistantAvatarButton', () => {
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

// `mockEditor` is assigned per test; the factory only closes over it, so it is read at render
// time (long after the TDZ) rather than when jest hoists this mock above the imports.
var mockEditor
var mockInputProps

jest.mock('../../../Feeds/CommentsTextInput/CustomTextInput3', () => {
    const React = require('react')
    return React.forwardRef((props, ref) => {
        mockInputProps = props
        React.useImperativeHandle(ref, () => ({
            clear: jest.fn(),
            blur: jest.fn(),
            isFocused: () => false,
        }))
        React.useEffect(() => {
            props.setEditor?.(mockEditor)
        }, [])
        return <input data-testid="assistant-text-input" readOnly value="" />
    })
})

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'

import AssistantOptions from './AssistantOptions'
import { insertFilesAsAttachments } from '../../../Feeds/CommentsTextInput/textInputHelper'
import { updateNewAttachmentsData } from '../../../Feeds/Utils/HelperFunctions'
import { createBotQuickTopic } from '../../../../utils/assistantHelper'
import { checkIsLimitedByTraffic } from '../../../Premium/PremiumHelper'

const IMAGE_TRIGGER = 'O2TI5plHBf1QfdY'
const imageMessage = `${IMAGE_TRIGGER}blob:shot.png${IMAGE_TRIGGER}blob:shot.png${IMAGE_TRIGGER}shot.png${IMAGE_TRIGGER}1`
const uploadedImageMessage = `${IMAGE_TRIGGER}https://cdn/full.png${IMAGE_TRIGGER}https://cdn/small.png${IMAGE_TRIGGER}shot.png${IMAGE_TRIGGER}0`

const imageFile = (name = 'shot.png') => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' })

describe('dragging an image onto the assistant line (AT-2444)', () => {
    let container
    let root

    beforeAll(() => {
        global.IS_REACT_ACT_ENVIRONMENT = true
    })

    beforeEach(async () => {
        jest.clearAllMocks()
        checkIsLimitedByTraffic.mockReturnValue(false)
        insertFilesAsAttachments.mockReturnValue({ addedFiles: [imageFile()], nextCursorIndex: 3 })
        updateNewAttachmentsData.mockImplementation(async (projectId, text) => text)
        createBotQuickTopic.mockResolvedValue({ projectId: 'selected-project', chatId: 'chat-1' })
        mockEditor = { focus: jest.fn(), getLength: () => 1 }
        mockInputProps = null

        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)

        await act(async () => {
            root.render(<AssistantOptions amountOfButtonOptions={1} />)
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
        const button = container.querySelector('[data-testid="assistant-send-button"]')
        await act(async () => {
            button.click()
        })
    }

    it('inserts a file dropped anywhere on the card, not just on the 40px field', () => {
        const file = imageFile()
        // The avatar sits in the row beside the input and is nowhere near it.
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

    it('hands the drop the editor the composer is actually using', () => {
        dropOn('[data-testid="assistant-text-input"]', [imageFile()])
        expect(insertFilesAsAttachments.mock.calls[0][0].editor).toBe(mockEditor)
    })

    it('advances the caret so a second dropped file lands after the first', () => {
        dropOn('[data-testid="assistant-avatar-stub"]', [imageFile('first.png')])
        expect(insertFilesAsAttachments.mock.calls[0][0].startIndex).toBe(0)

        insertFilesAsAttachments.mockReturnValue({ addedFiles: [imageFile('second.png')], nextCursorIndex: 6 })
        dropOn('[data-testid="assistant-avatar-stub"]', [imageFile('second.png')])
        expect(insertFilesAsAttachments.mock.calls[1][0].startIndex).toBe(3)
    })

    it('inserts nothing when the project is over its traffic quota', () => {
        checkIsLimitedByTraffic.mockReturnValue(true)
        const event = dropOn('[data-testid="assistant-avatar-stub"]', [imageFile()])

        expect(insertFilesAsAttachments).not.toHaveBeenCalled()
        // Still claimed: the browser must not navigate away just because the quota is spent.
        expect(event.defaultPrevented).toBe(true)
    })

    it('ignores a drag that carries no files, so dragging text inside the editor still works', () => {
        const event = dropOn('[data-testid="assistant-text-input"]', [])

        expect(insertFilesAsAttachments).not.toHaveBeenCalled()
        expect(event.defaultPrevented).toBe(false)
    })

    it('declares the attachment formats — without them paste and the app embeds are dead', () => {
        expect(mockInputProps.otherFormats).toEqual(
            expect.arrayContaining(['image', 'attachment', 'customImageFormat', 'videoFormat'])
        )
        // The exact predicate CustomTextInput3 keys `appManagedFileUpload` on.
        expect(
            mockInputProps.otherFormats.some(format => format === 'attachment' || format === 'customImageFormat')
        ).toBe(true)
    })

    it('gives the drop zone the project the conversation will be created in', () => {
        // Not the assistant's own project: a thread started here inherits the selected project.
        expect(mockInputProps.projectId).toBe('selected-project')
    })

    it('uploads the attachment before creating the topic and sends the rewritten text', async () => {
        updateNewAttachmentsData.mockResolvedValue(uploadedImageMessage)
        await typeMessage(imageMessage)
        await pressSend()

        expect(updateNewAttachmentsData).toHaveBeenCalledWith('selected-project', imageMessage)
        expect(createBotQuickTopic).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'assistant-1' }),
            uploadedImageMessage,
            expect.objectContaining({ projectId: 'selected-project' })
        )

        // The blob: URL must never reach the comment — it would render as a broken image for
        // everyone else and carry no mediaContext for the assistant.
        const [, sentText] = createBotQuickTopic.mock.calls[0]
        expect(sentText).not.toContain('blob:')
    })

    it('uploads before creating the topic, never after', async () => {
        const order = []
        updateNewAttachmentsData.mockImplementation(async (projectId, text) => {
            order.push('upload')
            return text
        })
        createBotQuickTopic.mockImplementation(async () => {
            order.push('createTopic')
            return { projectId: 'selected-project', chatId: 'chat-1' }
        })

        await typeMessage(imageMessage)
        await pressSend()

        expect(order).toEqual(['upload', 'createTopic'])
    })

    it('lets an image be sent on its own, with no typed prose', async () => {
        await typeMessage(imageMessage)

        const button = container.querySelector('[data-testid="assistant-send-button"]')
        expect(button.disabled).toBe(false)

        await pressSend()
        expect(createBotQuickTopic).toHaveBeenCalledTimes(1)
    })

    it('keeps the send button disabled while the composer is empty', () => {
        const button = container.querySelector('[data-testid="assistant-send-button"]')
        expect(button.disabled).toBe(true)
    })

    it('still sends a plain text message unchanged', async () => {
        await typeMessage('Summarise my open tasks')
        await pressSend()

        expect(createBotQuickTopic).toHaveBeenCalledWith(
            expect.objectContaining({ uid: 'assistant-1' }),
            'Summarise my open tasks',
            expect.any(Object)
        )
    })

    it('raises the composer height cap only while it holds media', async () => {
        expect(mockInputProps.maxHeight).toBe(120)

        await typeMessage(imageMessage)
        expect(mockInputProps.maxHeight).toBe(260)

        await typeMessage('just words now')
        expect(mockInputProps.maxHeight).toBe(120)
    })
})
