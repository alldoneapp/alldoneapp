import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text, TouchableOpacity } from 'react-native'

let mockArtifact
let mockReduxState

jest.mock('react-redux', () => ({ useSelector: selector => selector(mockReduxState) }))
jest.mock('./useArtifacts', () => ({
    useArtifact: () => mockArtifact,
    useArtifactVersions: () => [],
}))
jest.mock(
    './ArtifactPreview',
    () =>
        function MockArtifactPreview() {
            return null
        }
)
// The comment popup used everywhere else (AT-2888): the real ArtifactCommentsPopup, with the
// popover drawn inline and the modal reduced to the props it is given.
jest.mock('../UIComponents/ModalShell/AppPopover', () => {
    const { View: MockView } = require('react-native')
    return ({ content, children, isOpen, onClickOutside }) => (
        <MockView testID="mock-app-popover" isOpen={isOpen} onClickOutside={onClickOutside}>
            {children}
            {isOpen ? content : null}
        </MockView>
    )
})
jest.mock('../UIComponents/FloatModals/RichCommentModal/RichCommentModal', () => {
    const { View: MockView } = require('react-native')
    return props => <MockView testID="artifact-comment-popup" {...props} />
})
jest.mock('../../hooks/useFloatPopupLock', () => () => ({ acquire: jest.fn(), release: jest.fn() }))
jest.mock('../../utils/backends/Chats/chatsComments', () => ({ createObjectMessage: jest.fn(() => Promise.resolve()) }))
jest.mock('../Feeds/CommentsTextInput/textInputHelper', () => ({
    RECORD_SCREEN_MODAL_ID: 'RECORD_SCREEN_MODAL_ID',
    RECORD_VIDEO_MODAL_ID: 'RECORD_VIDEO_MODAL_ID',
}))
jest.mock('../ModalsManager/modalsManager', () => ({
    BOT_OPTION_MODAL_ID: 'BOT_OPTION_MODAL_ID',
    BOT_WARNING_MODAL_ID: 'BOT_WARNING_MODAL_ID',
    MENTION_MODAL_ID: 'MENTION_MODAL_ID',
    RUN_OUT_OF_GOLD_MODAL_ID: 'RUN_OUT_OF_GOLD_MODAL_ID',
}))
jest.mock('./ArtifactChat', () => {
    const { Text: MockText } = require('react-native')
    return ({ artifact }) => <MockText testID="artifact-chat">{artifact.id}</MockText>
})
jest.mock('../../URLSystem/Artifacts/URLsArtifacts', () => ({
    __esModule: true,
    default: { push: jest.fn() },
    URL_ARTIFACT_DETAILS: 'ARTIFACT_DETAILS',
    URL_ARTIFACT_DETAILS_CHAT: 'ARTIFACT_DETAILS_CHAT',
    getArtifactDetailsUrl: section =>
        ({
            chat: 'ARTIFACT_DETAILS_CHAT',
            updates: 'ARTIFACT_DETAILS_UPDATES',
            details: 'ARTIFACT_DETAILS_PROPERTIES',
        })[section] || 'ARTIFACT_DETAILS',
}))
jest.mock('./ArtifactHistory', () => {
    const { Text: MockText } = require('react-native')
    return ({ artifactId }) => <MockText testID="artifact-history-section">{artifactId}</MockText>
})
jest.mock('./ArtifactUpload', () => {
    const React = require('react')
    return {
        ArtifactFileInput: React.forwardRef(() => null),
        ArtifactUploadStatus: () => null,
        useArtifactUploader: () => ({ uploading: false, error: null, uploadFiles: jest.fn() }),
    }
})
jest.mock('../UIControls/Button', () => {
    const { Text: MockText, TouchableOpacity: MockTouchable } = require('react-native')
    return ({ title, onPress, testID }) => (
        <MockTouchable onPress={onPress} testID={testID}>
            <MockText>{title}</MockText>
        </MockTouchable>
    )
})
jest.mock('../Icon', () => () => null)
jest.mock('../../utils/backends/Artifacts/artifactsFirestore', () => ({
    deleteArtifact: jest.fn(),
    getArtifactUrl: () => 'https://serve.example/a',
    getArtifactPublicUrl: artifact =>
        artifact?.publicLink?.token ? `https://artifacts.example/${artifact.publicLink.token}/` : null,
    setArtifactPublicLink: jest.fn(() => Promise.resolve()),
    restoreArtifactVersion: jest.fn(),
    setArtifactPrivacy: jest.fn(),
    updateArtifactMetadata: jest.fn(),
    watchArtifactBacklinks: jest.fn(() => () => {}),
    setArtifactDataAccess: jest.fn(() => Promise.resolve()),
    getArtifactContextTitle: jest.fn(async () => 'Prepare the offsite'),
}))
const mockOpenSource = jest.fn()
jest.mock('./uploadSourceLinks', () => ({ openUploadSource: (...args) => mockOpenSource(...args) }))
jest.mock('../../utils/HelperFunctions', () => ({ copyTextToClipboard: jest.fn() }))
jest.mock('../UIComponents/FloatModals/DateFormatPickerModal', () => ({
    getDateFormat: () => 'DD.MM.YYYY',
    getTimeFormat: () => 'HH:mm',
}))

import ArtifactDetail from './ArtifactDetail'
import { setArtifactDataAccess, setArtifactPublicLink } from '../../utils/backends/Artifacts/artifactsFirestore'
import URLsArtifacts from '../../URLSystem/Artifacts/URLsArtifacts'
import { setArtifactSection } from './artifactsNavigationState'
import { translate as translateKey } from '../../i18n/TranslationService'

const mounted = []
function render() {
    let tree
    act(() => {
        tree = renderer.create(<ArtifactDetail projectId="project-a" artifactId="a1" onBack={jest.fn()} />)
    })
    mounted.push(tree)
    return tree
}

const textOf = node =>
    typeof node === 'string'
        ? node
        : Array.isArray(node)
          ? node.map(textOf).join('')
          : node && node.children
            ? node.children.map(textOf).join('')
            : ''

// A button is found by its visible text, or by its label when it only shows an icon.
const pressButton = (tree, title) =>
    act(() =>
        tree.root
            .findAllByType(TouchableOpacity)
            .find(
                node =>
                    node.props.accessibilityLabel === title ||
                    node.findAllByType(Text).some(text => textOf(text.children) === title)
            )
            .props.onPress()
    )

const showDetails = tree => pressButton(tree, 'Details')

const findPressable = (tree, testID) =>
    tree.root.findAllByProps({ testID }).find(node => typeof node.props.onPress === 'function')
const pressTestID = async (tree, testID) => {
    await act(async () => findPressable(tree, testID).props.onPress())
}
const textByTestID = (tree, testID) => {
    const [node] = tree.root.findAllByProps({ testID })
    return node ? textOf(node.children) : null
}

afterEach(() => act(() => mounted.splice(0).forEach(tree => tree.unmount())))

beforeEach(() => {
    jest.clearAllMocks()
    mockReduxState = { loggedUser: { uid: 'owner' }, openModals: {} }
    act(() => setArtifactSection('project-a', 'artifact'))
    mockArtifact = {
        id: 'a1',
        title: 'Sales dashboard',
        kind: 'web',
        source: 'assistant',
        entryPath: 'index.html',
        sizeBytes: 2048,
        lastEditionDate: 1_800_000_000_000,
        userId: 'owner',
        isPrivate: false,
        currentVersionId: 'v1',
        publicLink: { token: 'tok_abcdefghijklmnopqrst', createdAt: 1, createdBy: 'owner' },
    }
})

describe('ArtifactDetail', () => {
    describe('the chat bubble opens the comment popup used everywhere else (AT-2888)', () => {
        const popups = tree => tree.root.findAllByProps({ testID: 'artifact-comment-popup' }, { deep: false })

        it("opens the artifact's own thread in RichCommentModal and closes it again", () => {
            mockArtifact.assistantId = 'assistant-7'
            const tree = render()
            expect(popups(tree)).toHaveLength(0)

            pressButton(tree, 'Comments')
            const [popup] = popups(tree)
            expect(popup.props).toEqual(
                expect.objectContaining({
                    projectId: 'project-a',
                    objectType: 'artifacts',
                    objectId: 'a1',
                    objectName: 'Sales dashboard',
                    showBotButton: true,
                    externalAssistantId: 'assistant-7',
                    initialObject: mockArtifact,
                })
            )
            // It is a popup over the artifact, not a switch to the Chat section.
            expect(tree.root.findAllByProps({ testID: 'artifact-chat' })).toHaveLength(0)
            expect(tree.root.findAllByProps({ testID: 'artifact-preview-area' }).length).toBeGreaterThan(0)
            expect(URLsArtifacts.push).not.toHaveBeenCalled()

            act(() => popup.props.closeModal())
            expect(popups(tree)).toHaveLength(0)
        })

        it('closes on a click outside the popup', () => {
            const tree = render()
            pressButton(tree, 'Comments')
            const [popover] = tree.root.findAllByProps({ testID: 'mock-app-popover' }, { deep: false })
            act(() => popover.props.onClickOutside())
            expect(popups(tree)).toHaveLength(0)
        })

        it("posts a comment into the artifact's thread, with the assistant switch the popup reports", async () => {
            const { createObjectMessage } = require('../../utils/backends/Chats/chatsComments')
            const tree = render()
            pressButton(tree, 'Comments')
            await act(async () => popups(tree)[0].props.processDone('Add a chart', [], false, false, true))
            expect(createObjectMessage).toHaveBeenCalledWith(
                'project-a',
                'a1',
                'Add a chart',
                'artifacts',
                null,
                null,
                null,
                false,
                true
            )
        })

        it('stays open while a nested popup of the composer (mentions) owns the click', () => {
            const tree = render()
            pressButton(tree, 'Comments')
            mockReduxState = { ...mockReduxState, openModals: { MENTION_MODAL_ID: true } }
            act(() => tree.update(<ArtifactDetail projectId="project-a" artifactId="a1" onBack={jest.fn()} />))
            act(() => popups(tree)[0].props.closeModal())
            expect(popups(tree)).toHaveLength(1)

            mockReduxState = { ...mockReduxState, openModals: {} }
            act(() => tree.update(<ArtifactDetail projectId="project-a" artifactId="a1" onBack={jest.fn()} />))
            act(() => popups(tree)[0].props.closeModal())
            expect(popups(tree)).toHaveLength(0)
        })
    })

    describe('full screen (AT-2888)', () => {
        let open
        beforeEach(() => {
            open = jest.spyOn(window, 'open').mockImplementation(() => null)
        })
        afterEach(() => open.mockRestore())

        it('opens the public link, the same address the link button hands out', () => {
            const tree = render()
            pressButton(tree, 'Open full screen')
            expect(open).toHaveBeenCalledWith(
                'https://artifacts.example/tok_abcdefghijklmnopqrst/',
                '_blank',
                'noopener,noreferrer'
            )
        })

        it('falls back to the internal address without a public link, making nothing public', () => {
            mockArtifact = { ...mockArtifact, publicLink: null, isPrivate: true }
            const tree = render()
            pressButton(tree, 'Open full screen')
            expect(open).toHaveBeenCalledWith('https://serve.example/a', '_blank', 'noopener,noreferrer')
            expect(setArtifactPublicLink).not.toHaveBeenCalled()
        })
    })

    it('switches between the artifact and its chat, and keeps the address in step', () => {
        mockArtifact.commentsData = { amount: 3 }
        const tree = render()
        expect(tree.root.findAllByProps({ testID: 'artifact-chat' })).toHaveLength(0)

        pressButton(tree, 'Chat · 3')
        expect(tree.root.findAllByProps({ testID: 'artifact-chat' }, { deep: false })).toHaveLength(1)
        expect(tree.root.findAllByProps({ testID: 'artifact-meta' })).toHaveLength(0)
        expect(URLsArtifacts.push).toHaveBeenLastCalledWith(
            'ARTIFACT_DETAILS_CHAT',
            null,
            'project-a',
            'a1',
            'Sales dashboard'
        )

        pressButton(tree, 'Artifact')
        expect(tree.root.findAllByProps({ testID: 'artifact-chat' })).toHaveLength(0)
        expect(URLsArtifacts.push).toHaveBeenLastCalledWith(
            'ARTIFACT_DETAILS',
            null,
            'project-a',
            'a1',
            'Sales dashboard'
        )
    })

    it('lets the owner switch on live data only after confirming, and switch it off directly', async () => {
        const tree = render()
        showDetails(tree)
        const toggle = () => tree.root.findByProps({ testID: 'artifact-toggle-live-data' }).props.onPress()

        act(() => toggle())
        expect(setArtifactDataAccess).not.toHaveBeenCalled()
        expect(tree.root.findAllByProps({ testID: 'artifact-live-data-warning' }).length).toBeGreaterThan(0)

        await act(async () => toggle())
        expect(setArtifactDataAccess).toHaveBeenCalledWith('project-a', 'a1', true)

        mockArtifact = { ...mockArtifact, dataAccess: true }
        const on = render()
        showDetails(on)
        await act(async () => on.root.findByProps({ testID: 'artifact-toggle-live-data' }).props.onPress())
        expect(setArtifactDataAccess).toHaveBeenLastCalledWith('project-a', 'a1', false)
    })

    it('shows the live data state to others without the switch, and not at all for non-web files', () => {
        mockArtifact = { ...mockArtifact, userId: 'someone-else' }
        const other = render()
        showDetails(other)
        expect(other.root.findAllByProps({ testID: 'artifact-live-data' }).length).toBeGreaterThan(0)
        expect(other.root.findAllByProps({ testID: 'artifact-toggle-live-data' })).toHaveLength(0)

        mockArtifact = { ...mockArtifact, kind: 'pdf' }
        const pdf = render()
        showDetails(pdf)
        expect(pdf.root.findAllByProps({ testID: 'artifact-live-data' })).toHaveLength(0)
    })

    it('shows what happened to the artifact in its own section', () => {
        const tree = render()
        pressButton(tree, 'Updates')
        expect(tree.root.findAllByProps({ testID: 'artifact-history-section' }, { deep: false })).toHaveLength(1)
        expect(tree.root.findAllByProps({ testID: 'artifact-meta' })).toHaveLength(0)
        expect(URLsArtifacts.push).toHaveBeenLastCalledWith(
            'ARTIFACT_DETAILS_UPDATES',
            null,
            'project-a',
            'a1',
            'Sales dashboard'
        )
    })

    describe('the public link', () => {
        const { copyTextToClipboard } = require('../../utils/HelperFunctions')

        it('is copied from the top right of the artifact page, and says so', async () => {
            const tree = render()
            const header = tree.root.findAllByProps({ testID: 'artifact-header' })[0]
            expect(header.findAllByProps({ testID: 'artifact-copy-link' }).length).toBeGreaterThan(0)

            pressButton(tree, 'Copy public link')
            expect(copyTextToClipboard).toHaveBeenLastCalledWith('https://artifacts.example/tok_abcdefghijklmnopqrst/')
            expect(textByTestID(tree, 'artifact-link-copied')).toContain('Anyone with it can open the artifact')
        })

        it('copies the address for project members from the top right while it is switched off', () => {
            mockArtifact = { ...mockArtifact, publicLink: null }
            const tree = render()
            pressButton(tree, 'Copy link for project members')
            expect(copyTextToClipboard).toHaveBeenLastCalledWith(
                `${window.location.origin}/projects/project-a/artifacts/a1`
            )
            expect(textByTestID(tree, 'artifact-link-copied')).toContain('Project members')
        })

        it('shows the address under Details and copies either link from there', async () => {
            const tree = render()
            showDetails(tree)
            expect(textByTestID(tree, 'artifact-public-link-url')).toBe(
                'https://artifacts.example/tok_abcdefghijklmnopqrst/'
            )

            await pressTestID(tree, 'artifact-public-link-copy')
            expect(copyTextToClipboard).toHaveBeenLastCalledWith('https://artifacts.example/tok_abcdefghijklmnopqrst/')

            await pressTestID(tree, 'artifact-member-link-copy')
            expect(copyTextToClipboard).toHaveBeenLastCalledWith(
                `${window.location.origin}/projects/project-a/artifacts/a1`
            )
        })

        it('changes the link and switches it off only on a second press', async () => {
            const tree = render()
            showDetails(tree)

            await pressTestID(tree, 'artifact-public-link-change')
            expect(setArtifactPublicLink).not.toHaveBeenCalled()
            expect(textByTestID(tree, 'artifact-public-link-confirm')).toContain('stops working')
            await pressTestID(tree, 'artifact-public-link-change')
            expect(setArtifactPublicLink).toHaveBeenLastCalledWith('project-a', 'a1', 'change')
            expect(textByTestID(tree, 'artifact-public-link-notice')).toContain('The old one no longer works')

            await pressTestID(tree, 'artifact-public-link-disable')
            expect(setArtifactPublicLink).toHaveBeenCalledTimes(1)
            await pressTestID(tree, 'artifact-public-link-disable')
            expect(setArtifactPublicLink).toHaveBeenLastCalledWith('project-a', 'a1', 'disable')
        })

        it('switches a link that is off on at once', async () => {
            mockArtifact = { ...mockArtifact, publicLink: null }
            const tree = render()
            showDetails(tree)
            expect(tree.root.findAllByProps({ testID: 'artifact-public-link-url' })).toHaveLength(0)
            expect(textByTestID(tree, 'artifact-public-link-off')).toContain('Only project members')

            await pressTestID(tree, 'artifact-public-link-enable')
            expect(setArtifactPublicLink).toHaveBeenCalledWith('project-a', 'a1', 'enable')
        })

        it('reports a failed change next to the link', async () => {
            setArtifactPublicLink.mockImplementationOnce(() => Promise.reject({ code: 'offline' }))
            const tree = render()
            showDetails(tree)
            await pressTestID(tree, 'artifact-public-link-change')
            await pressTestID(tree, 'artifact-public-link-change')
            expect(textByTestID(tree, 'artifact-public-link-notice')).toBe(
                translateKey('Artifact action needs internet')
            )
        })
    })

    it('uploads a new version from Details, next to the versions', () => {
        const tree = render()
        const header = tree.root.findAllByProps({ testID: 'artifact-header' })[0]
        expect(header.findAllByProps({ testID: 'artifact-upload-version' })).toHaveLength(0)
        showDetails(tree)
        const versions = tree.root.findAllByProps({ testID: 'artifact-versions' })[0]
        expect(versions.findAllByProps({ testID: 'artifact-upload-version' }).length).toBeGreaterThan(0)
    })

    it('says where the artifact came from', () => {
        const tree = render()
        showDetails(tree)
        const meta = tree.root.findAllByProps({ testID: 'artifact-meta' })[0]
        expect(textOf(meta.children)).toContain('Created by an assistant')
    })

    it('leads to the thread the artifact was made in', async () => {
        mockArtifact.parentObject = { type: 'tasks', id: 'task-9', projectId: 'project-a' }
        const tree = render()
        showDetails(tree)
        await act(async () => {})
        const link = tree.root.findAll(
            node => node.props.testID === 'artifact-context' && typeof node.props.onPress === 'function'
        )[0]
        expect(textOf(link.findAllByType(Text)[0].children)).toBe('Created in Prepare the offsite')
        act(() => link.props.onPress())
        expect(mockOpenSource).toHaveBeenCalledWith('project-a', {
            type: 'tasks',
            id: 'task-9',
            projectId: 'project-a',
            inThread: true,
        })
    })

    it('shows no such link for an artifact uploaded straight into the artifacts', () => {
        const tree = render()
        showDetails(tree)
        expect(tree.root.findAll(node => node.props.testID === 'artifact-context' && node.props.onPress)).toHaveLength(
            0
        )
    })
    describe('the artifact gets the room (AT-2879)', () => {
        it('opens on the artifact with nothing but the preview below the header', () => {
            const tree = render()
            expect(tree.root.findAllByProps({ testID: 'artifact-preview-area' }).length).toBeGreaterThan(0)
            expect(tree.root.findAllByProps({ testID: 'artifact-details' })).toHaveLength(0)
            for (const testID of [
                'artifact-meta',
                'artifact-title-input',
                'artifact-live-data',
                'artifact-toggle-privacy',
                'artifact-context',
                'artifact-versions',
            ])
                expect(tree.root.findAllByProps({ testID })).toHaveLength(0)
            for (const title of ['Copy link for project members', 'Delete artifact', 'Change link'])
                expect(tree.root.findAll(node => node.type === Text && textOf(node.children) === title)).toHaveLength(0)
        })

        it('keeps title, sections and the three artifact actions in one header row', () => {
            const tree = render()
            const header = tree.root.findAllByProps({ testID: 'artifact-header' })[0]
            expect(textOf(header.findAllByProps({ testID: 'artifact-title' })[0].children)).toBe('Sales dashboard')
            const tabs = header.findAll(node => node.props.accessibilityRole === 'tab' && node.props.testID)
            expect([...new Set(tabs.map(node => node.props.testID))]).toEqual([
                'artifact-section-artifact',
                'artifact-section-chat',
                'artifact-section-updates',
                'artifact-section-details',
            ])
            for (const testID of [
                'artifact-open-full-screen',
                'artifact-comments',
                'artifact-copy-link',
                'artifact-back',
            ])
                expect(header.findAllByProps({ testID }).length).toBeGreaterThan(0)
        })

        it('moves everything else into Details and keeps the address in step', () => {
            const tree = render()
            showDetails(tree)
            expect(tree.root.findAllByProps({ testID: 'artifact-details' }).length).toBeGreaterThan(0)
            expect(tree.root.findAllByProps({ testID: 'artifact-preview-area' })).toHaveLength(0)
            expect(tree.root.findAllByProps({ testID: 'artifact-title-input' }).length).toBeGreaterThan(0)
            expect(tree.root.findAllByProps({ testID: 'artifact-toggle-privacy' }).length).toBeGreaterThan(0)
            expect(URLsArtifacts.push).toHaveBeenLastCalledWith(
                'ARTIFACT_DETAILS_PROPERTIES',
                null,
                'project-a',
                'a1',
                'Sales dashboard'
            )
        })

        it('keeps privacy switching for the owner only', () => {
            mockArtifact = { ...mockArtifact, userId: 'someone-else' }
            const tree = render()
            showDetails(tree)
            expect(tree.root.findAllByProps({ testID: 'artifact-toggle-privacy' })).toHaveLength(0)
        })

        it('lets the artifact grow to its natural height instead of a fixed frame (AT-2881)', () => {
            const MockArtifactPreview = require('./ArtifactPreview')
            const tree = render()
            const [preview] = tree.root.findAllByType(MockArtifactPreview)
            expect(preview.props.autoHeight).toBe(true)
            expect(preview.props.artifact).toBe(mockArtifact)
        })

        it('opens the comment popup from any section without changing it', () => {
            const tree = render()
            showDetails(tree)
            URLsArtifacts.push.mockClear()
            pressButton(tree, 'Comments')
            expect(tree.root.findAllByProps({ testID: 'artifact-comment-popup' }, { deep: false })).toHaveLength(1)
            expect(tree.root.findAllByProps({ testID: 'artifact-details' }).length).toBeGreaterThan(0)
            expect(URLsArtifacts.push).not.toHaveBeenCalled()
        })
    })
})

describe('computePreviewHeight', () => {
    const { computePreviewHeight, MIN_PREVIEW_HEIGHT, PREVIEW_BOTTOM_GAP } = require('./ArtifactDetail')

    it('fills the window from where the frame starts down to the bottom edge', () => {
        expect(computePreviewHeight(1000, 300)).toBe(1000 - 300 - PREVIEW_BOTTOM_GAP)
    })

    it('never goes below a usable minimum on a short window', () => {
        expect(computePreviewHeight(500, 400)).toBe(MIN_PREVIEW_HEIGHT)
        expect(computePreviewHeight(undefined, undefined)).toBe(MIN_PREVIEW_HEIGHT)
    })
})
