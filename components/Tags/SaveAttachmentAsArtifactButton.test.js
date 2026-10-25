import React from 'react'
import renderer, { act } from 'react-test-renderer'

const mockSave = jest.fn()
const mockOpen = jest.fn()

jest.mock('../../utils/backends/Artifacts/artifactsFirestore', () => ({
    saveAttachmentAsArtifact: (...args) => mockSave(...args),
}))
jest.mock('../ArtifactsView/artifactLinks', () => ({ openProjectArtifacts: (...args) => mockOpen(...args) }))
jest.mock('../Icon', () => {
    const { Text } = require('react-native')
    return ({ name }) => <Text testID="icon">{name}</Text>
})
jest.mock('../UIComponents/Spinner', () => () => null)

import SaveAttachmentAsArtifactButton from './SaveAttachmentAsArtifactButton'

const URI = 'https://firebasestorage.googleapis.com/v0/b/b/o/attachments%2Fc%2Fa.pdf?alt=media&token=t'

const mounted = []
function render(props = {}) {
    let tree
    act(() => {
        tree = renderer.create(
            <SaveAttachmentAsArtifactButton projectId="project-a" uri={URI} fileName="a.pdf" {...props} />
        )
    })
    mounted.push(tree)
    return tree
}

const button = tree => tree.root.findAllByProps({ testID: 'save-attachment-as-artifact' })[0]
const iconName = tree => tree.root.findAllByProps({ testID: 'icon' })[0]?.props.children

afterEach(() => act(() => mounted.splice(0).forEach(tree => tree.unmount())))
beforeEach(() => jest.clearAllMocks())

describe('SaveAttachmentAsArtifactButton', () => {
    it('saves the attachment once, then opens the new artifact on the next press', async () => {
        mockSave.mockResolvedValue({ artifactId: 'artifact-1', isPrivate: true })
        const tree = render()
        expect(iconName(tree)).toBe('package')

        await act(async () => button(tree).props.onPress())
        expect(mockSave).toHaveBeenCalledWith('project-a', URI, 'a.pdf')
        expect(iconName(tree)).toBe('check')
        expect(button(tree).props.accessibilityLabel).toBe('Saved as a private artifact. Open it')

        await act(async () => button(tree).props.onPress())
        expect(mockSave).toHaveBeenCalledTimes(1)
        expect(mockOpen).toHaveBeenCalledWith('project-a', 'artifact-1')
    })

    it('says so when saving failed and lets the user try again', async () => {
        mockSave.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'offline' }))
        const tree = render()

        await act(async () => button(tree).props.onPress())
        expect(iconName(tree)).toBe('alert-circle')

        mockSave.mockResolvedValueOnce({ artifactId: 'artifact-2' })
        await act(async () => button(tree).props.onPress())
        expect(iconName(tree)).toBe('check')
    })

    it('renders nothing without a project or a file address', () => {
        expect(render({ projectId: '' }).toJSON()).toBeNull()
        expect(render({ uri: '' }).toJSON()).toBeNull()
    })
})
