import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'

let mockArtifacts
const mockUpload = jest.fn()
const mockPush = jest.fn()
const mockOpenSource = jest.fn()
jest.mock('./uploadSourceLinks', () => ({ openUploadSource: (...args) => mockOpenSource(...args) }))

jest.mock('react-redux', () => ({ useSelector: selector => selector({ loggedUser: { uid: 'owner' } }) }))
jest.mock('./useArtifacts', () => ({
    useProjectArtifacts: () => ({ artifacts: mockArtifacts, loaded: true }),
}))
jest.mock('../TaskListView/ProjectSection', () => {
    const { View } = require('react-native')
    const Section = ({ children }) => <View>{children}</View>
    return { __esModule: true, default: Section, ProjectSectionBody: Section }
})
jest.mock('../TaskListView/Header/ProjectHeader', () => {
    const { View } = require('react-native')
    return ({ showRootSectionNavigation }) => (
        <View testID="project-header" showRootSectionNavigation={showRootSectionNavigation} />
    )
})
jest.mock('../UIControls/Button', () => {
    const { Text, TouchableOpacity } = require('react-native')
    return ({ title, onPress, accessibilityLabel }) => (
        <TouchableOpacity onPress={onPress} accessibilityLabel={accessibilityLabel}>
            <Text>{title}</Text>
        </TouchableOpacity>
    )
})
jest.mock('./ArtifactFileViewer', () => {
    const { Text } = require('react-native')
    return ({ fileId, files }) => (
        <Text testID="artifact-file-viewer" files={files}>
            {fileId}
        </Text>
    )
})
jest.mock('./ArtifactDetail', () => {
    const { Text } = require('react-native')
    return ({ artifactId }) => <Text testID="artifact-detail">{artifactId}</Text>
})
jest.mock('../Premium/PremiumHelper', () => ({ checkIsLimitedByTraffic: () => false }))
jest.mock('../../utils/backends/Artifacts/artifactsFirestore', () => ({
    isArtifactUploadTooLarge: files => files.some(file => file.size > 20 * 1024 * 1024),
    uploadArtifactFiles: (...args) => mockUpload(...args),
    getArtifactContextTitle: async () => 'Prepare the offsite',
    getArtifactUrl: (projectId, artifact) =>
        `https://serve.test/a/${projectId}/${artifact.id}/secret/${artifact.title}`,
}))
jest.mock('../../URLSystem/Artifacts/URLsArtifacts', () => ({
    __esModule: true,
    default: { push: (...args) => mockPush(...args) },
    URL_ARTIFACT_DETAILS: 'ARTIFACT_DETAILS',
    URL_PROJECT_ARTIFACTS: 'PROJECT_ARTIFACTS',
}))
jest.mock('./artifactLinks', () => ({ openProjectArtifacts: jest.fn() }))
jest.mock('../UIComponents/FloatModals/DateFormatPickerModal', () => ({
    getDateFormat: () => 'DD.MM.YYYY',
    getTimeFormat: () => 'HH:mm',
}))

import ProjectArtifacts from './ProjectArtifacts'

// The pressable host of a testID: the composite that carries the testID has no onPress of its own.
const pressable = (tree, testID) =>
    tree.root.findAll(node => node.props.testID === testID && typeof node.props.onPress === 'function')[0]
const texts = node =>
    node
        .findAllByType(Text)
        .map(text => [].concat(text.props.children).join(''))
        .join(' ')
import { setSelectedArtifactId } from './artifactsNavigationState'
import { openProjectArtifacts } from './artifactLinks'

const PROJECT = { id: 'project-a', index: 0, color: '#000' }

let mounted = []

async function render(props = {}) {
    let tree
    await act(async () => {
        tree = renderer.create(<ProjectArtifacts project={PROJECT} {...props} />)
    })
    mounted.push(tree)
    return tree
}

// A tree left mounted keeps listening to the shared navigation state and reacts to the next test.
afterEach(() => {
    act(() => mounted.forEach(tree => tree.unmount()))
    mounted = []
})

function dropEvent(files) {
    return {
        dataTransfer: { files, types: ['Files'] },
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
    }
}

beforeEach(() => {
    mockUpload.mockReset()
    mockPush.mockReset()
    mockOpenSource.mockReset()
    setSelectedArtifactId(PROJECT.id, null)
    mockArtifacts = [
        { id: 'newer', title: 'Q3 dashboard', kind: 'web', lastEditionDate: 2, sizeBytes: 10, versionCount: 2 },
        { id: 'older', title: 'Report', kind: 'pdf', lastEditionDate: 1, sizeBytes: 10, versionCount: 1 },
    ]
})

it('lists the artifacts in the order it is given, newest edit first', async () => {
    const tree = await render()
    const rows = tree.root.findAll(
        node => typeof node.props.testID === 'string' && node.props.testID.startsWith('artifact-row-'),
        { deep: false }
    )
    expect(rows.map(row => row.props.testID)).toEqual(['artifact-row-newer', 'artifact-row-older'])
})

it('opens an artifact in place and gives it its own address', async () => {
    const tree = await render()
    await act(async () => tree.root.findByProps({ testID: 'artifact-row-older' }).props.onPress())

    expect(tree.root.findByProps({ testID: 'artifact-detail' }).props.children).toBe('older')
    expect(mockPush).toHaveBeenCalledWith('ARTIFACT_DETAILS', null, 'project-a', 'older', 'Report')
})

it('opens an artifact as a detail view without the project line or the section navigation (AT-2882)', async () => {
    const tree = await render()
    const header = tree.root.findAll(node => node.props.testID === 'project-header', { deep: false })
    expect(header).toHaveLength(1)
    expect(header[0].props.showRootSectionNavigation).toBe(true)

    await act(async () => tree.root.findByProps({ testID: 'artifact-row-older' }).props.onPress())
    expect(tree.root.findAllByProps({ testID: 'project-header' })).toHaveLength(0)
    expect(tree.root.findAllByProps({ testID: 'artifacts-list-project-a' })).toHaveLength(0)
    expect(tree.root.findByProps({ testID: 'artifact-detail' }).props.children).toBe('older')

    // Back to the list brings both back.
    await act(async () => setSelectedArtifactId(PROJECT.id, null))
    expect(tree.root.findAll(node => node.props.testID === 'project-header', { deep: false })).toHaveLength(1)
    expect(tree.root.findAllByProps({ testID: 'artifact-detail' })).toHaveLength(0)
})

it('switches to the project when an artifact is opened from All projects', async () => {
    const tree = await render({ inAllProjects: true })
    await act(async () => tree.root.findByProps({ testID: 'artifact-row-newer' }).props.onPress())
    expect(openProjectArtifacts).toHaveBeenCalledWith('project-a', 'newer')
})

it('turns every dropped file into its own artifact and opens the new one', async () => {
    mockUpload.mockImplementation(async ({ files }) => ({ artifactId: `id-${files[0].name}`, created: true }))
    const tree = await render()
    const zone = tree.root.findByProps({ 'data-testid': 'artifacts-drop-project-a' })

    await act(async () =>
        zone.props.onDropCapture(
            dropEvent([
                { name: 'a.html', size: 1 },
                { name: 'b.pdf', size: 1 },
            ])
        )
    )

    expect(mockUpload).toHaveBeenCalledTimes(2)
    expect(mockUpload.mock.calls.map(([args]) => args.files.map(file => file.name))).toEqual([['a.html'], ['b.pdf']])
    expect(tree.root.findByProps({ testID: 'artifact-detail' }).props.children).toBe('id-b.pdf')
    // The address follows, or a reload would land on the list again.
    expect(mockPush).toHaveBeenLastCalledWith('ARTIFACT_DETAILS', null, 'project-a', 'id-b.pdf')
})

it('refuses an upload over 20 MB before sending anything', async () => {
    const tree = await render()
    const zone = tree.root.findByProps({ 'data-testid': 'artifacts-drop-project-a' })

    await act(async () => zone.props.onDropCapture(dropEvent([{ name: 'big.zip', size: 21 * 1024 * 1024 }])))

    expect(mockUpload).not.toHaveBeenCalled()
    expect(tree.root.findByProps({ testID: 'artifact-upload-error' }).findByType(Text).props.children).toBeTruthy()
})

it('hides an empty project in All projects', async () => {
    mockArtifacts = []
    const tree = await render({ inAllProjects: true })
    expect(tree.toJSON()).toBeNull()
})

it('filters by kind when there is more than one kind, and offers no filter otherwise', async () => {
    const tree = await render()
    const rowIds = () =>
        tree.root
            .findAll(node => typeof node.props.testID === 'string' && node.props.testID.startsWith('artifact-row-'), {
                deep: false,
            })
            .map(row => row.props.testID)

    expect(tree.root.findAllByProps({ testID: 'artifacts-kind-files' })).toHaveLength(0)
    await act(async () => tree.root.findByProps({ testID: 'artifacts-kind-documents' }).props.onPress())
    expect(rowIds()).toEqual(['artifact-row-older'])
    await act(async () => tree.root.findByProps({ testID: 'artifacts-kind-all' }).props.onPress())
    expect(rowIds()).toEqual(['artifact-row-newer', 'artifact-row-older'])

    mockArtifacts = [mockArtifacts[0]]
    const single = await render()
    expect(single.root.findAllByProps({ testID: 'artifacts-kind-filter' })).toHaveLength(0)
})

it('opens a linked upload without a file address in its original source, creating no detail or share link', async () => {
    const source = { type: 'notes', id: 'original-note', title: 'Meeting notes' }
    mockArtifacts = [
        { id: 'upload:path', title: 'Existing.pdf', kind: 'pdf', linkedUpload: true, linkedSources: [source] },
    ]
    const tree = await render()
    await act(async () => tree.root.findByProps({ testID: 'artifact-row-upload:path' }).props.onPress())
    expect(mockOpenSource).toHaveBeenCalledWith('project-a', source)
    expect(mockPush).not.toHaveBeenCalled()
    expect(mockUpload).not.toHaveBeenCalled()
    expect(tree.root.findAllByProps({ testID: 'artifact-detail' })).toHaveLength(0)
})

const rowIdsOf = tree =>
    tree.root
        .findAll(node => typeof node.props.testID === 'string' && node.props.testID.startsWith('artifact-row-'), {
            deep: false,
        })
        .map(row => row.props.testID.replace('artifact-row-', ''))

const manyArtifacts = count =>
    Array.from({ length: count }, (_, index) => ({
        id: `a${index}`,
        title: `Report ${index}.pdf`,
        kind: 'pdf',
        lastEditionDate: count - index,
        sizeBytes: 1,
        versionCount: 1,
    }))

it('shows three per project in All projects and the rest behind show more, like Notes', async () => {
    mockArtifacts = manyArtifacts(5)
    const tree = await render({ inAllProjects: true })
    expect(rowIdsOf(tree)).toEqual(['a0', 'a1', 'a2'])

    const toggle = () => tree.root.findByType(require('../UIControls/ShowMoreButton').default)
    await act(async () => toggle().props.expand())
    expect(rowIdsOf(tree)).toEqual(['a0', 'a1', 'a2', 'a3', 'a4'])
    await act(async () => toggle().props.contract())
    expect(rowIdsOf(tree)).toEqual(['a0', 'a1', 'a2'])
})

it('shows ten in a single project and offers no show more when nothing is hidden', async () => {
    mockArtifacts = manyArtifacts(12)
    const tree = await render()
    expect(rowIdsOf(tree)).toHaveLength(10)
    expect(tree.root.findAllByType(require('../UIControls/ShowMoreButton').default)).toHaveLength(1)

    mockArtifacts = manyArtifacts(3)
    const short = await render({ inAllProjects: true })
    expect(rowIdsOf(short)).toHaveLength(3)
    expect(short.root.findAllByType(require('../UIControls/ShowMoreButton').default)).toHaveLength(0)
})

it('shows a linked screenshot in the viewer, and its context line still leads to the source', async () => {
    const source = { type: 'tasks', id: 'task-1', title: 'Roadmap' }
    const shot = {
        id: 'upload:attachments/c/shot.png',
        title: 'shot.png',
        kind: 'image',
        linkedUpload: true,
        linkedSources: [source],
        url: 'https://storage.test/shot.png?token=t',
        thumbnailUrl: 'https://storage.test/shot_300x300.png?token=t',
    }
    mockArtifacts = [shot, { ...mockArtifacts[0] }]
    openProjectArtifacts.mockClear()
    const tree = await render({ inAllProjects: true })

    // The row draws the stored thumbnail, not the full file.
    expect(tree.root.findByProps({ 'data-testid': 'artifact-thumbnail-image' }).props.src).toBe(shot.thumbnailUrl)

    await act(async () => tree.root.findByProps({ testID: `artifact-row-${shot.id}` }).props.onPress())
    const viewer = tree.root.findByProps({ testID: 'artifact-file-viewer' })
    expect(viewer.props.children).toBe(shot.id)
    // It walks through the uploads only; a full artifact opens its own detail.
    expect(viewer.props.files.map(file => file.id)).toEqual([shot.id])
    expect(mockOpenSource).not.toHaveBeenCalled()
    expect(openProjectArtifacts).not.toHaveBeenCalled()

    await act(async () => pressable(tree, `artifact-open-source-${shot.id}`).props.onPress())
    expect(mockOpenSource).toHaveBeenCalledWith('project-a', expect.objectContaining(source))
    expect(tree.root.findAllByProps({ testID: 'artifact-file-viewer' })).toHaveLength(0)
})

it('names where a linked upload came from, and how many more places hold it', async () => {
    const shot = {
        id: 'upload:notesAttachments/n/shot.png',
        title: 'shot.png',
        kind: 'image',
        linkedUpload: true,
        linkedSources: [
            { type: 'notes', id: 'note-1', title: 'Meeting notes' },
            { type: 'tasks', id: 'task-1', title: 'Roadmap', commentId: 'c' },
        ],
        url: 'https://storage.test/shot.png?token=t',
    }
    mockArtifacts = [shot]
    const tree = await render()
    expect(texts(pressable(tree, `artifact-open-source-${shot.id}`))).toContain('In Meeting notes +1')
    await act(async () => pressable(tree, `artifact-open-source-${shot.id}`).props.onPress())
    expect(mockOpenSource).toHaveBeenCalledWith(
        'project-a',
        expect.objectContaining({ type: 'notes', id: 'note-1', projectId: 'project-a' })
    )
})

it('leads from an artifact an assistant made to the thread it was made in', async () => {
    mockArtifacts = [
        {
            ...mockArtifacts[0],
            id: 'made-in-a-task',
            parentObject: { type: 'tasks', id: 'task-9', projectId: 'project-a' },
        },
    ]
    const tree = await render()
    await act(async () => pressable(tree, 'artifact-open-source-made-in-a-task').props.onPress())
    expect(mockOpenSource).toHaveBeenCalledWith('project-a', {
        type: 'tasks',
        id: 'task-9',
        projectId: 'project-a',
        inThread: true,
    })
})

it('offers no context for an artifact uploaded straight into the artifacts', async () => {
    mockArtifacts = [{ ...mockArtifacts[0], id: 'plain', parentObject: null }]
    const tree = await render()
    expect(pressable(tree, 'artifact-open-source-plain')).toBeUndefined()
})

it('previews a full image artifact through serveArtifact and keeps the icon for other kinds', async () => {
    mockArtifacts = [
        { id: 'img', title: 'chart.png', kind: 'image', lastEditionDate: 2, sizeBytes: 1, versionCount: 1 },
        { id: 'doc', title: 'Report', kind: 'pdf', lastEditionDate: 1, sizeBytes: 1, versionCount: 1 },
    ]
    const tree = await render()
    const images = tree.root.findAllByProps({ 'data-testid': 'artifact-thumbnail-image' })
    expect(images.map(image => image.props.src)).toEqual(['https://serve.test/a/project-a/img/secret/chart.png'])

    // A preview that cannot load falls back to the kind icon instead of a broken image.
    await act(async () => images[0].props.onError())
    expect(tree.root.findAllByProps({ 'data-testid': 'artifact-thumbnail-image' })).toHaveLength(0)
})

// AT-2887: linked uploads from legacy tasks carried Number.MAX_SAFE_INTEGER as their date and the
// row read "Edited Invalid date". A date that is not a real time is left out, never made up.
it('never prints "Invalid date": a row without a trustworthy date simply has no edited label', async () => {
    mockArtifacts = [
        { id: 'legacy', title: 'image.jpg', kind: 'image', lastEditionDate: Number.MAX_SAFE_INTEGER, sizeBytes: 1 },
        { id: 'dated', title: 'Report', kind: 'pdf', lastEditionDate: Date.UTC(2026, 9, 27, 9, 25), sizeBytes: 1 },
    ]
    const tree = await render()
    const legacy = texts(tree.root.findByProps({ testID: 'artifact-row-legacy' }))
    const dated = texts(tree.root.findByProps({ testID: 'artifact-row-dated' }))
    expect(legacy).not.toMatch(/Invalid date/)
    expect(legacy).not.toMatch(/Edited|Bearbeitet/)
    expect(dated).toMatch(/27\.10\.2026/)
})

it('reports its count and its newest artifact date, so All projects can order the projects', async () => {
    const onLoaded = jest.fn()
    const newest = Date.UTC(2026, 9, 27, 9, 25)
    mockArtifacts = [
        { id: 'legacy', title: 'image.jpg', kind: 'image', lastEditionDate: Number.MAX_SAFE_INTEGER },
        { id: 'older', title: 'Report', kind: 'pdf', lastEditionDate: newest - 1000 },
        { id: 'newest', title: 'Deck', kind: 'pdf', lastEditionDate: newest },
    ]
    await render({ inAllProjects: true, onLoaded })
    expect(onLoaded).toHaveBeenLastCalledWith('project-a', 3, newest)
})
