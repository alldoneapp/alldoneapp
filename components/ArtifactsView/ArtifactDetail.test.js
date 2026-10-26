import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text, TouchableOpacity } from 'react-native'

let mockArtifact

jest.mock('react-redux', () => ({ useSelector: selector => selector({ loggedUser: { uid: 'owner' } }) }))
jest.mock('./useArtifacts', () => ({
    useArtifact: () => mockArtifact,
    useArtifactVersions: () => [],
}))
jest.mock('./ArtifactPreview', () => () => null)
jest.mock('./ArtifactAssistantForm', () => {
    const { Text: MockText } = require('react-native')
    return ({ artifact, onClose, onSent }) => (
        <MockText testID="artifact-assistant-form" onPress={onClose} onLongPress={onSent}>
            {artifact.id}
        </MockText>
    )
})
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
    return ({ title, onPress }) => (
        <MockTouchable onPress={onPress}>
            <MockText>{title}</MockText>
        </MockTouchable>
    )
})
jest.mock('../Icon', () => () => null)
jest.mock('../../utils/backends/Artifacts/artifactsFirestore', () => ({
    deleteArtifact: jest.fn(),
    getArtifactUrl: () => 'https://serve.example/a',
    resetArtifactLink: jest.fn(),
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
import { setArtifactDataAccess } from '../../utils/backends/Artifacts/artifactsFirestore'
import URLsArtifacts from '../../URLSystem/Artifacts/URLsArtifacts'
import { setArtifactSection } from './artifactsNavigationState'

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

afterEach(() => act(() => mounted.splice(0).forEach(tree => tree.unmount())))

beforeEach(() => {
    jest.clearAllMocks()
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
    }
})

describe('ArtifactDetail', () => {
    it('opens and closes the change-with-assistant form for this artifact', () => {
        const tree = render()
        expect(tree.root.findAllByProps({ testID: 'artifact-assistant-form' })).toHaveLength(0)

        pressButton(tree, 'Change with assistant')
        const form = tree.root.findAllByProps({ testID: 'artifact-assistant-form' }, { deep: false })
        expect(form).toHaveLength(1)
        expect(textOf(form[0].children)).toBe('a1')

        act(() => form[0].props.onPress())
        expect(tree.root.findAllByProps({ testID: 'artifact-assistant-form' })).toHaveLength(0)
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

    it('opens the chat once a change request has been sent to the assistant', () => {
        const tree = render()
        pressButton(tree, 'Change with assistant')
        const form = tree.root.findAllByProps({ testID: 'artifact-assistant-form' }, { deep: false })[0]
        act(() => form.props.onLongPress())
        expect(tree.root.findAllByProps({ testID: 'artifact-assistant-form' })).toHaveLength(0)
        expect(tree.root.findAllByProps({ testID: 'artifact-chat' }, { deep: false })).toHaveLength(1)
    })

    it('copies the in-app link at once and the sign-in-free link only after a warning', () => {
        const { copyTextToClipboard } = require('../../utils/HelperFunctions')
        const tree = render()
        showDetails(tree)

        pressButton(tree, 'Copy link')
        expect(copyTextToClipboard).toHaveBeenLastCalledWith(
            `${window.location.origin}/projects/project-a/artifacts/a1`
        )

        pressButton(tree, 'Share outside the project')
        expect(copyTextToClipboard).toHaveBeenCalledTimes(1)
        expect(tree.root.findAllByProps({ testID: 'artifact-outside-share-warning' })).not.toHaveLength(0)

        pressButton(tree, 'Copy link for outside')
        expect(copyTextToClipboard).toHaveBeenLastCalledWith('https://serve.example/a')
        expect(tree.root.findAllByProps({ testID: 'artifact-outside-share-warning' })).toHaveLength(0)
        const notice = tree.root.findAllByProps({ testID: 'artifact-notice' })[0]
        expect(textOf(notice.children)).toContain('until you reset the link')
    })

    it('can back out of sharing outside the project', () => {
        const { copyTextToClipboard } = require('../../utils/HelperFunctions')
        const tree = render()
        showDetails(tree)
        pressButton(tree, 'Share outside the project')
        act(() => tree.root.findByProps({ testID: 'artifact-outside-share-cancel' }).props.onPress())
        expect(tree.root.findAllByProps({ testID: 'artifact-outside-share-warning' })).toHaveLength(0)
        expect(copyTextToClipboard).not.toHaveBeenCalled()
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
            for (const title of ['Copy link', 'Delete artifact', 'Reset link'])
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
                'artifact-change-with-assistant',
                'artifact-upload-version',
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

        it('changing with the assistant from another section goes back to the artifact first', () => {
            const tree = render()
            showDetails(tree)
            pressButton(tree, 'Change with assistant')
            expect(tree.root.findAllByProps({ testID: 'artifact-assistant-form' }, { deep: false })).toHaveLength(1)
            expect(tree.root.findAllByProps({ testID: 'artifact-preview-area' }).length).toBeGreaterThan(0)
            expect(URLsArtifacts.push).toHaveBeenLastCalledWith(
                'ARTIFACT_DETAILS',
                null,
                'project-a',
                'a1',
                'Sales dashboard'
            )
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
