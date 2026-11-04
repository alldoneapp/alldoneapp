import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import EmbeddedToolWindow from './EmbeddedToolWindow'
import { createHandoffChannel, HANDOFF_TIMEOUT_MS, openToolHandoff } from './embeddedToolHandoff'
import { readEmbeddedToolWindow } from '../../../../utils/embeddedToolWindowUrl'

jest.mock('./EmbeddedAppFrame', () => ({
    __esModule: true,
    default: ({ url, handoffRestore }) => (
        <button data-url={url} onClick={() => handoffRestore?.onRestored(true)}>
            Restore tool
        </button>
    ),
}))

jest.mock('../../../../i18n/TranslationService', () => ({ translate: key => key }))

const location = 'https://alldone.team/paul-product-manager/create-roadmap?month=10#view'
const toolPath = '/tools/alldone-team/paul-product-manager/create-roadmap'

describe('moving an embedded tool between signed-in tabs', () => {
    const instances = []
    let container
    let root
    let open

    beforeEach(() => {
        jest.useFakeTimers()
        global.BroadcastChannel = class {
            constructor(name) {
                this.name = name
                instances.push(this)
            }
            postMessage(data) {
                instances
                    .filter(peer => peer !== this && !peer.closed && peer.name === this.name)
                    .forEach(peer => peer.onmessage?.({ data }))
            }
            close() {
                this.closed = true
            }
        }
        jest.spyOn(window.crypto, 'randomUUID').mockReturnValue('ab123456-1234-1234-1234-123456789abc')
        open = jest.spyOn(window, 'open').mockReturnValue({ opener: window })
        container = document.createElement('div')
        document.body.append(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        delete global.BroadcastChannel
        instances.length = 0
        jest.restoreAllMocks()
        jest.useRealTimers()
        window.history.replaceState(null, '', '/')
    })

    it('hands off the current view and leaves a durable tool address that can load on its own', async () => {
        const onComplete = jest.fn()
        const capture = jest.fn(async () => ({ url: location, captured: true }))
        expect(openToolHandoff({ url: location, title: 'Roadmap', userId: 'owner', capture, onComplete })).toBe(
            'pending'
        )
        const target = new URL(open.mock.calls[0][0])
        const id = target.searchParams.get('toolHandoff')
        expect(id).toBeTruthy()
        expect(target.pathname).toBe(toolPath)
        expect([...target.searchParams.keys()]).toEqual(['toolHandoff'])
        expect(target.hash).toBe('')

        window.history.replaceState(null, '', target)
        const initial = readEmbeddedToolWindow()
        await act(async () =>
            root.render(<EmbeddedToolWindow id={initial.handoffId} url={initial.url} userId="owner" />)
        )
        expect(container.textContent).toContain('Restore tool')
        expect(container.querySelector('button').dataset.url).toContain(`month=10&alldoneHandoff=${id}#view`)
        expect(onComplete).not.toHaveBeenCalled()
        act(() => container.querySelector('button').click())
        expect(onComplete).toHaveBeenCalledWith(true)
        expect(window.location.pathname).toBe(toolPath)
        expect(window.location.search).toBe('')

        const reopened = readEmbeddedToolWindow()
        const channelCount = instances.length
        await act(async () =>
            root.render(<EmbeddedToolWindow key="reloaded" id={reopened.handoffId} url={reopened.url} userId="owner" />)
        )
        expect(container.querySelector('button').dataset.url).toBe(location.split('?')[0])
        expect(instances).toHaveLength(channelCount)
    })

    it('keeps the source open if the browser blocks opening or a different account receives the URL', async () => {
        const onComplete = jest.fn()
        const capture = jest.fn(async () => ({ url: location, captured: true }))
        const args = { url: location, title: 'Roadmap', userId: 'owner', capture, onComplete }
        open.mockReturnValueOnce(null)
        expect(openToolHandoff(args)).toBe('blocked')
        expect(capture).not.toHaveBeenCalled()

        expect(openToolHandoff(args)).toBe('pending')
        const id = new URL(open.mock.calls[1][0]).searchParams.get('toolHandoff')
        const unrelated = createHandoffChannel(id)
        const received = jest.fn()
        unrelated.onmessage = received
        unrelated.postMessage({ type: 'ready', userId: 'other' })
        await act(async () => jest.advanceTimersByTime(HANDOFF_TIMEOUT_MS))
        expect(received).not.toHaveBeenCalled()
        expect(onComplete).toHaveBeenCalledWith(false)
    })
})
