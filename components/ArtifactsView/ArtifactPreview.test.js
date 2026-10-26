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

describe('natural height (AT-2881)', () => {
    const { ARTIFACT_FRAME_PROTOCOL } = require('../../functions/Artifacts/artifactFrameHeight')

    // A rendered frame with a window of its own, as react-dom would give it.
    async function renderFramed(props) {
        const frameWindow = { postMessage: jest.fn() }
        let tree
        await act(async () => {
            tree = renderer.create(<ArtifactPreview projectId="project-a" {...props} />, {
                createNodeMock: element => (element.type === 'iframe' ? { contentWindow: frameWindow } : null),
            })
        })
        return { tree, frameWindow }
    }

    async function post(data, { source, origin = 'null' } = {}) {
        await act(async () => {
            window.dispatchEvent(new MessageEvent('message', { data, source, origin }))
        })
    }

    const heightMessage = height => ({ protocol: ARTIFACT_FRAME_PROTOCOL, type: 'height', height })
    const frameOf = tree => byTestId(tree, 'artifact-preview-frame')[0]

    it('takes the height its own page reports, and follows it as the page changes', async () => {
        const { tree, frameWindow } = await renderFramed({ artifact: artifact(), height: 700, autoHeight: true })
        expect(frameOf(tree).props.style.height).toBe(700)

        await post(heightMessage(2480), { source: frameWindow })
        expect(frameOf(tree).props.style.height).toBe(2480)
        expect(frameOf(tree).props['data-natural-height']).toBe('true')

        await post(heightMessage(310), { source: frameWindow })
        expect(frameOf(tree).props.style.height).toBe(310)
        // Isolation is untouched.
        expect(frameOf(tree).props.sandbox).toBe(ARTIFACT_IFRAME_SANDBOX)
    })

    it('ignores a height from any other window, from a real origin, or in any other shape', async () => {
        const { tree, frameWindow } = await renderFramed({ artifact: artifact(), height: 700, autoHeight: true })
        await post(heightMessage(2000), { source: { postMessage: jest.fn() } })
        await post(heightMessage(2000), { source: window })
        await post(heightMessage(2000), { source: frameWindow, origin: 'https://evil.example' })
        await post({ protocol: 'alldone-bridge-v1', type: 'height', height: 2000 }, { source: frameWindow })
        await post(heightMessage('tall'), { source: frameWindow })
        expect(frameOf(tree).props.style.height).toBe(700)
    })

    it('caps what a page may ask for', async () => {
        const { MAX_FRAME_CONTENT_HEIGHT } = require('../../functions/Artifacts/artifactFrameHeight')
        const { tree, frameWindow } = await renderFramed({ artifact: artifact(), height: 700, autoHeight: true })
        await post(heightMessage(10 ** 9), { source: frameWindow })
        expect(frameOf(tree).props.style.height).toBe(MAX_FRAME_CONTENT_HEIGHT)
    })

    it('grows a data-bound page too, with the bridge still answering only that frame', async () => {
        const { tree, frameWindow } = await renderFramed({
            artifact: artifact({ dataAccess: true }),
            height: 700,
            autoHeight: true,
        })
        expect(frameOf(tree).props['data-bridge']).toBe('true')
        await post(heightMessage(1500), { source: frameWindow })
        expect(frameOf(tree).props.style.height).toBe(1500)
    })

    it('keeps a fixed frame where the caller fixes it (a note card) and for a PDF', async () => {
        const { tree, frameWindow } = await renderFramed({ artifact: artifact(), height: 260 })
        await post(heightMessage(2000), { source: frameWindow })
        expect(frameOf(tree).props.style.height).toBe(260)

        const pdf = await renderFramed({
            artifact: artifact({ kind: 'pdf', mimeType: 'application/pdf', entryPath: 'r.pdf' }),
            height: 700,
            autoHeight: true,
        })
        await post(heightMessage(2000), { source: pdf.frameWindow })
        expect(byTestId(pdf.tree, 'artifact-preview-pdf')[0].props.style.height).toBe(700)
    })
})
