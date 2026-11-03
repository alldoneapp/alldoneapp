/**
 * @jest-environment jsdom
 *
 * AT-2955: an embedded web app may tell the assistant what it shows (`APP_CONTEXT`, the iframe
 * counterpart of MCP Apps' `ui/update-model-context`). Only its own frame on its own origin may,
 * only in the assistant pane (a `contextId`), and what it says is kept as untrusted app state.
 */
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { getAppModelContext } from '../../../../utils/annaAppModelContext'

jest.mock('react-redux', () => ({
    useSelector: selector => selector({ loggedUser: { email: 'user@example.com' }, loggedUserProjects: [] }),
}))
jest.mock('../../../../utils/backends/firestore', () => ({ runHttpsCallableFunction: jest.fn() }))
jest.mock('../../../../utils/NavigationService', () => ({}))
jest.mock('../../../../URLSystem/URLTrigger', () => ({ processUrl: jest.fn() }))
jest.mock('../../../../utils/roadmapSourceBridge', () => ({
    ALLDONE_ROADMAP_PROTOCOL_VERSION: 1,
    getActiveRoadmapProjects: () => [],
}))

const EmbeddedAppFrame = require('./EmbeddedAppFrame').default

const URL_ = 'https://alldone.team/story-builder?embed=true'
const VIEW_ID = `iframe:${URL_}`
const report = { type: 'APP_CONTEXT', context: { text: 'Story: MCP, Juno & AI · scene 3 of 25' } }

describe('APP_CONTEXT from an embedded app', () => {
    let container
    let root
    let frameWindow
    const mount = props => {
        act(() => root.render(<EmbeddedAppFrame url={URL_} title="Story Builder" {...props} />))
        frameWindow = container.querySelector('iframe').contentWindow
    }
    const send = (data, { origin = 'https://alldone.team', source = frameWindow } = {}) => {
        const event = new MessageEvent('message', { data, origin })
        Object.defineProperty(event, 'source', { value: source })
        act(() => window.dispatchEvent(event))
    }

    beforeEach(() => {
        global.IS_REACT_ACT_ENVIRONMENT = true
        jest.spyOn(console, 'log').mockImplementation(() => {})
        jest.spyOn(console, 'warn').mockImplementation(() => {})
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })
    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        jest.restoreAllMocks()
        delete global.IS_REACT_ACT_ENVIRONMENT
    })

    it('is kept for the pane view and never logged', () => {
        mount({ contextId: VIEW_ID })
        send(report)
        expect(getAppModelContext(VIEW_ID)).toMatchObject({ text: 'Story: MCP, Juno & AI · scene 3 of 25' })
        expect(JSON.stringify(console.log.mock.calls)).not.toContain('scene 3')
        // Leaving the pane forgets it: it described a frame that is gone.
        act(() => root.unmount())
        root = createRoot(container)
        expect(getAppModelContext(VIEW_ID)).toBeNull()
    })

    it('is refused from another origin or another window', () => {
        mount({ contextId: VIEW_ID })
        send(report, { origin: 'https://evil.example' })
        send(report, { source: {} })
        expect(getAppModelContext(VIEW_ID)).toBeNull()
    })

    it('is ignored in the embed window, where nobody reads it', () => {
        mount({})
        send(report)
        expect(getAppModelContext(VIEW_ID)).toBeNull()
    })
})
