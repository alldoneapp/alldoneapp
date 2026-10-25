import React from 'react'
import renderer, { act } from 'react-test-renderer'

let mockState

jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState) }))
jest.mock('../../utils/backends/Artifacts/artifactsFirestore', () => ({
    getArtifactUrl: (projectId, artifact, { bridge } = {}) =>
        `https://functions.test/serveArtifact/a/${projectId}/${artifact.id}/${artifact.serveSecret}/${artifact.entryPath}` +
        (bridge ? '?alldone-bridge=1' : ''),
}))
jest.mock('../WikiView/WikiMarkdown', () => {
    const { Text } = require('react-native')
    return ({ body }) => <Text testID="markdown-body">{body}</Text>
})
jest.mock('../UIComponents/FloatModals/DateFormatPickerModal', () => ({
    getDateFormat: () => 'DD.MM.YYYY',
    getTimeFormat: () => 'HH:mm',
}))

import ArtifactPreview, { ARTIFACT_IFRAME_SANDBOX } from './ArtifactPreview'

const artifact = overrides => ({
    id: 'artifact1',
    title: 'Dashboard',
    serveSecret: 'secret-aaaaaaaaaaaaaaaaaaaaaa',
    kind: 'web',
    mimeType: 'text/html',
    entryPath: 'index.html',
    sizeBytes: 100,
    ...overrides,
})

async function render(props) {
    let tree
    await act(async () => {
        tree = renderer.create(<ArtifactPreview projectId="project-a" {...props} />)
    })
    return tree
}

const byTestId = (tree, testID) =>
    tree.root.findAll(node => node.props['data-testid'] === testID || node.props.testID === testID)

beforeEach(() => {
    mockState = { connectionState: '' }
    global.fetch = jest.fn(async () => ({ ok: true, text: async () => '# Report' }))
})

it('frames an HTML artifact sandboxed, from the artifact address and without a referrer', async () => {
    const tree = await render({ artifact: artifact() })
    const [frame] = byTestId(tree, 'artifact-preview-frame')

    expect(frame.type).toBe('iframe')
    expect(frame.props.src).toBe(
        'https://functions.test/serveArtifact/a/project-a/artifact1/secret-aaaaaaaaaaaaaaaaaaaaaa/index.html'
    )
    expect(frame.props.sandbox).toBe(ARTIFACT_IFRAME_SANDBOX)
    expect(frame.props.referrerPolicy).toBe('no-referrer')
    expect(ARTIFACT_IFRAME_SANDBOX).toContain('allow-scripts')
    expect(ARTIFACT_IFRAME_SANDBOX).not.toContain('allow-same-origin')
    expect(ARTIFACT_IFRAME_SANDBOX).not.toContain('allow-top-navigation')
})

it('frames a PDF without the sandbox, which Chrome would refuse to render', async () => {
    const tree = await render({ artifact: artifact({ kind: 'pdf', mimeType: 'application/pdf', entryPath: 'r.pdf' }) })
    const [frame] = byTestId(tree, 'artifact-preview-pdf')
    expect(frame.props.sandbox).toBeUndefined()
})

it('says the preview needs a connection instead of spinning while offline', async () => {
    mockState = { connectionState: 'offline' }
    const tree = await render({ artifact: artifact() })
    expect(byTestId(tree, 'artifact-preview-offline')).not.toHaveLength(0)
    expect(byTestId(tree, 'artifact-preview-frame')).toHaveLength(0)
})

it('offers a download for a file type it cannot show', async () => {
    const tree = await render({ artifact: artifact({ kind: 'file', mimeType: 'application/zip', entryPath: 'a.zip' }) })
    expect(byTestId(tree, 'artifact-preview-none')).not.toHaveLength(0)
    const link = tree.root.findByType('a')
    expect(link.props.href).toContain('/a.zip')
    expect(link.props.rel).toBe('noopener noreferrer')
})

it('fetches and renders a markdown artifact in the app', async () => {
    const tree = await render({
        artifact: artifact({ kind: 'markdown', mimeType: 'text/markdown', entryPath: 'r.md' }),
    })
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/r.md'), { referrerPolicy: 'no-referrer' })
    expect(tree.root.findByProps({ testID: 'markdown-body' }).props.children).toBe('# Report')
})

it('frames a data-bound page at the bridge address with nothing but scripts allowed', async () => {
    const tree = await render({ artifact: artifact({ dataAccess: true }) })
    const [frame] = byTestId(tree, 'artifact-preview-frame')

    expect(frame.props.src).toBe(
        'https://functions.test/serveArtifact/a/project-a/artifact1/secret-aaaaaaaaaaaaaaaaaaaaaa/index.html?alldone-bridge=1'
    )
    expect(frame.props.sandbox).toBe('allow-scripts')
    expect(frame.props['data-bridge']).toBe('true')
    expect(typeof frame.props.onLoad).toBe('function')
})
