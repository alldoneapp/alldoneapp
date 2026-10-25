/**
 * @jest-environment jsdom
 */
import React, { useRef } from 'react'
import renderer, { act } from 'react-test-renderer'

import useArtifactDataBridge from './useArtifactDataBridge'
import { ARTIFACT_BRIDGE_PROTOCOL, BRIDGE_LIMITS } from '../../functions/Artifacts/artifactDataBridge'

// A stand-in for the frame: the hook only needs its contentWindow, which is what the page's
// messages come from and what answers go to.
function makeFrameWindow() {
    return { postMessage: jest.fn() }
}

let api
function Host({ frameWindow, runQuery, now }) {
    const frameRef = useRef({ contentWindow: frameWindow })
    api = { onLoad: useArtifactDataBridge({ frameRef, enabled: true, runQuery, now }) }
    return null
}

const flush = () => act(() => new Promise(resolve => setTimeout(resolve, 0)))

function post(source, data) {
    act(() => {
        window.dispatchEvent(
            new MessageEvent('message', { data: { protocol: ARTIFACT_BRIDGE_PROTOCOL, ...data }, source })
        )
    })
}

// The page opens the conversation and keeps the session token it is given.
function hello(source) {
    post(source, { type: 'hello' })
    const welcome = source.postMessage.mock.calls
        .map(([message]) => message)
        .find(message => message.type === 'welcome')
    return welcome?.session
}

let session
function ask(source, name, params = {}, id = 'q1', token = session) {
    post(source, { type: 'query', id, name, params, session: token })
}

const results = frameWindow => frameWindow.postMessage.mock.calls.filter(([message]) => message.type === 'result')

describe('useArtifactDataBridge', () => {
    let frameWindow
    let runQuery
    let tree
    let clock

    beforeEach(() => {
        frameWindow = makeFrameWindow()
        runQuery = jest.fn(async request => ({ asked: request.name, params: request.params }))
        clock = 1000
        act(() => {
            tree = renderer.create(<Host frameWindow={frameWindow} runQuery={runQuery} now={() => clock} />)
        })
        session = hello(frameWindow)
    })
    afterEach(() => act(() => tree.unmount()))

    it('answers its own frame with the normalized question', async () => {
        ask(frameWindow, 'tasks', { status: 'done', limit: 5, filter: 'nope' })
        await flush()
        expect(runQuery).toHaveBeenCalledWith({ id: 'q1', name: 'tasks', params: { status: 'done', limit: 5 } })
        expect(frameWindow.postMessage).toHaveBeenCalledWith(
            {
                protocol: ARTIFACT_BRIDGE_PROTOCOL,
                type: 'result',
                id: 'q1',
                result: { asked: 'tasks', params: { status: 'done', limit: 5 } },
            },
            '*'
        )
    })

    it('ignores every other window and every other protocol', async () => {
        const other = makeFrameWindow()
        hello(other)
        ask(other, 'project')
        act(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'query' }, source: frameWindow })))
        await flush()
        expect(runQuery).not.toHaveBeenCalled()
        expect(other.postMessage).not.toHaveBeenCalled()
        expect(results(frameWindow)).toHaveLength(0)
    })

    it('answers only questions that carry the session it handed out', async () => {
        expect(session).toMatch(/^[0-9a-f]{32}$/)
        ask(frameWindow, 'project', {}, 'forged', 'not-the-session')
        ask(frameWindow, 'project', {}, 'unsigned', null)
        await flush()
        expect(runQuery).not.toHaveBeenCalled()
    })

    it('ends the conversation when a second document says hello, even before the frame reports it loaded', async () => {
        act(() => api.onLoad())
        hello(frameWindow)
        ask(frameWindow, 'project')
        await flush()
        expect(runQuery).not.toHaveBeenCalled()
        expect(results(frameWindow)).toHaveLength(0)
    })

    it('stops answering once the frame has shown another page', async () => {
        act(() => api.onLoad())
        ask(frameWindow, 'project')
        await flush()
        expect(results(frameWindow)).toHaveLength(1)

        act(() => api.onLoad())
        ask(frameWindow, 'members', {}, 'q2')
        await flush()
        expect(results(frameWindow)).toHaveLength(1)
        expect(runQuery).toHaveBeenCalledTimes(1)
    })

    it('does not hand a slow answer to a page that navigated meanwhile', async () => {
        let resolve
        runQuery.mockImplementationOnce(() => new Promise(done => (resolve = done)))
        act(() => api.onLoad())
        ask(frameWindow, 'goals')
        await flush()
        act(() => api.onLoad())
        resolve([{ id: 'g1' }])
        await flush()
        expect(results(frameWindow)).toHaveLength(0)
    })

    it('reads the same question once in a while, and refuses a flood', async () => {
        ask(frameWindow, 'project', {}, 'a')
        ask(frameWindow, 'project', {}, 'b')
        await flush()
        expect(runQuery).toHaveBeenCalledTimes(1)
        expect(results(frameWindow)).toHaveLength(2)

        clock += BRIDGE_LIMITS.cacheMs + 1
        ask(frameWindow, 'project', {}, 'c')
        await flush()
        expect(runQuery).toHaveBeenCalledTimes(2)

        for (let i = 0; i < BRIDGE_LIMITS.queriesPerMinute; i += 1) ask(frameWindow, 'members', {}, `m${i}`)
        await flush()
        // The budget is per minute: three answered above, so the last three of these are refused.
        const refused = frameWindow.postMessage.mock.calls.filter(
            ([message]) => message.error === 'Too many questions. Try again in a minute.'
        )
        expect(refused.map(([message]) => message.id)).toEqual(['m27', 'm28', 'm29'])
    })

    it('reports unknown questions and failed reads to the page without details', async () => {
        ask(frameWindow, 'users')
        runQuery.mockRejectedValueOnce(new Error('permission-denied'))
        jest.spyOn(console, 'warn').mockImplementation(() => {})
        ask(frameWindow, 'goals', {}, 'q2')
        await flush()
        expect(frameWindow.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'q1', error: 'Unknown query "users".' }),
            '*'
        )
        expect(frameWindow.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'q2', error: 'Alldone could not load this data.' }),
            '*'
        )
        console.warn.mockRestore()
    })
})
