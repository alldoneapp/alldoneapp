import React from 'react'
import renderer, { act } from 'react-test-renderer'

jest.mock(
    '../UIComponents/ModalShell/WorkspaceModal',
    () =>
        ({ visible, children }) =>
            visible ? children : null
)
jest.mock('../../hooks/useSafeAreaOverlayPadding', () => () => ({}))

import ArtifactFileViewer from './ArtifactFileViewer'

const source = { type: 'tasks', id: 'task-1', title: 'Roadmap' }
const file = (id, kind, extra = {}) => ({
    id: `upload:${id}`,
    title: id,
    kind,
    linkedUpload: true,
    linkedSources: [source],
    url: `https://storage.test/${id}?token=t`,
    ...extra,
})
const FILES = [file('one.png', 'image'), file('clip.mp4', 'video'), file('report.pdf', 'pdf')]

let mounted = []
let onSelect, onClose, onOpenSource

function render(fileId, files = FILES) {
    let tree
    act(() => {
        tree = renderer.create(
            <ArtifactFileViewer
                files={files}
                fileId={fileId}
                onSelect={onSelect}
                onClose={onClose}
                onOpenSource={onOpenSource}
            />
        )
    })
    mounted.push(tree)
    return tree
}

beforeEach(() => {
    onSelect = jest.fn()
    onClose = jest.fn()
    onOpenSource = jest.fn()
})

// A mounted viewer keeps its document keydown listener and would answer the next test's keys.
afterEach(() => {
    act(() => mounted.forEach(tree => tree.unmount()))
    mounted = []
})

// `deep: false` stops at the outermost match: a react-native-web element carries `testID` and the
// host node it renders carries the same id again as `data-testid`.
const byTestId = (tree, id) =>
    tree.root.findAll(node => node.props['data-testid'] === id || node.props.testID === id, { deep: false })

it('shows an image from the address its source embeds', () => {
    const tree = render('upload:one.png')
    const [image] = byTestId(tree, 'artifact-viewer-image')
    expect(image.props.src).toBe('https://storage.test/one.png?token=t')
    expect(image.props.referrerPolicy).toBe('no-referrer')
})

it('plays a video inline and offers a PDF in a new tab instead of framing it', () => {
    expect(byTestId(render('upload:clip.mp4'), 'artifact-viewer-video')).toHaveLength(1)

    const open = jest.spyOn(window, 'open').mockImplementation(() => null)
    const pdf = render('upload:report.pdf')
    expect(byTestId(pdf, 'artifact-viewer-card')).toHaveLength(1)
    expect(pdf.root.findAll(node => node.type === 'iframe')).toHaveLength(0)
    act(() => byTestId(pdf, 'artifact-viewer-card-open')[0].props.onPress())
    expect(open).toHaveBeenCalledWith('https://storage.test/report.pdf?token=t', '_blank', 'noopener,noreferrer')
    open.mockRestore()
})

it('falls back to the card when an image cannot load', () => {
    const tree = render('upload:one.png')
    act(() => byTestId(tree, 'artifact-viewer-image')[0].props.onError())
    expect(byTestId(tree, 'artifact-viewer-image')).toHaveLength(0)
    expect(byTestId(tree, 'artifact-viewer-card')).toHaveLength(1)
})

it('walks through the files with the arrows and the arrow keys, wrapping at the ends', () => {
    const tree = render('upload:one.png')
    act(() => byTestId(tree, 'artifact-viewer-next')[0].props.onPress())
    expect(onSelect).toHaveBeenLastCalledWith('upload:clip.mp4')
    act(() => byTestId(tree, 'artifact-viewer-previous')[0].props.onPress())
    expect(onSelect).toHaveBeenLastCalledWith('upload:report.pdf')

    act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(onSelect).toHaveBeenLastCalledWith('upload:clip.mp4')
})

it('offers no arrows for a single file', () => {
    const tree = render('upload:one.png', [FILES[0]])
    expect(byTestId(tree, 'artifact-viewer-next')).toHaveLength(0)
    act(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    })
    expect(onSelect).not.toHaveBeenCalled()
})

it('leads to the source and closes from the header, the backdrop or a file that left the list', () => {
    const tree = render('upload:one.png')
    act(() => byTestId(tree, 'artifact-viewer-source')[0].props.onPress())
    expect(onOpenSource).toHaveBeenCalledWith(FILES[0])
    act(() => byTestId(tree, 'artifact-viewer-backdrop')[0].props.onPress())
    act(() => byTestId(tree, 'artifact-viewer-close')[0].props.onPress())
    expect(onClose).toHaveBeenCalledTimes(2)

    act(() =>
        tree.update(
            <ArtifactFileViewer
                files={FILES.slice(1)}
                fileId="upload:one.png"
                onSelect={onSelect}
                onClose={onClose}
                onOpenSource={onOpenSource}
            />
        )
    )
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(tree.toJSON()).toBeNull()
})
