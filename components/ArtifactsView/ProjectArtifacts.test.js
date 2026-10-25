import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { Text } from 'react-native'

let mockArtifacts
const mockUpload = jest.fn()
const mockPush = jest.fn()

jest.mock('react-redux', () => ({ useSelector: selector => selector({ loggedUser: { uid: 'owner' } }) }))
jest.mock('./useArtifacts', () => ({
    useProjectArtifacts: () => ({ artifacts: mockArtifacts, loaded: true }),
}))
jest.mock('../TaskListView/ProjectSection', () => {
    const { View } = require('react-native')
    const Section = ({ children }) => <View>{children}</View>
    return { __esModule: true, default: Section, ProjectSectionBody: Section }
})
jest.mock('../TaskListView/Header/ProjectHeader', () => () => null)
jest.mock('../UIControls/Button', () => {
    const { Text, TouchableOpacity } = require('react-native')
    return ({ title, onPress, accessibilityLabel }) => (
        <TouchableOpacity onPress={onPress} accessibilityLabel={accessibilityLabel}>
            <Text>{title}</Text>
        </TouchableOpacity>
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
