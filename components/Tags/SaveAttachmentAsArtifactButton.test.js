import React from 'react'
import renderer, { act } from 'react-test-renderer'

const mockOpen = jest.fn()
jest.mock('../ArtifactsView/artifactLinks', () => ({ openProjectUploads: (...args) => mockOpen(...args) }))
jest.mock('../Icon', () => () => null)
import SaveAttachmentAsArtifactButton from './SaveAttachmentAsArtifactButton'

const URI = 'https://firebasestorage.googleapis.com/v0/b/b/o/attachments%2Fc%2Fa.pdf?token=t'
const mounted = []
function render(props = {}) {
    let tree
    act(() => {
        tree = renderer.create(<SaveAttachmentAsArtifactButton projectId="p" uri={URI} {...props} />)
    })
    mounted.push(tree)
    return tree
}
afterEach(() => act(() => mounted.splice(0).forEach(tree => tree.unmount())))
beforeEach(() => jest.clearAllMocks())

it('opens the existing linked uploads on every press without a copy request', () => {
    const tree = render()
    const button = tree.root.findAllByProps({ testID: 'save-attachment-as-artifact' })[0]
    expect(button.props.accessibilityLabel).toBe('Show in artifacts')
    act(() => {
        button.props.onPress()
        button.props.onPress()
    })
    expect(mockOpen.mock.calls).toEqual([['p'], ['p']])
})
it('renders nothing without a project or file address', () => {
    expect(render({ projectId: '' }).toJSON()).toBeNull()
    expect(render({ uri: '' }).toJSON()).toBeNull()
})
