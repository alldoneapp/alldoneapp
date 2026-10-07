import React, { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import AnnaBrowserWorkspace from './AnnaBrowserWorkspace'
import { runHttpsCallableFunction } from '../../utils/backends/firestore'

jest.mock('../../utils/backends/firestore', () => ({ runHttpsCallableFunction: jest.fn() }))
jest.mock('../../utils/appResume', () => ({ subscribePageVisible: () => () => {} }))
jest.mock('../../i18n/TranslationService', () => ({ translate: text => text }))

let root, container, ref
const onResume = jest.fn()
const onControlChange = jest.fn()
const render = () =>
    act(async () =>
        root.render(
            <AnnaBrowserWorkspace
                ref={ref}
                browser={{ runId: 'run1' }}
                active
                onResume={onResume}
                onControlChange={onControlChange}
            />
        )
    )
beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    jest.clearAllMocks()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    ref = createRef()
})
afterEach(() => {
    act(() => root.unmount())
    container.remove()
    delete global.IS_REACT_ACT_ENVIRONMENT
})

it('waits for a frame request before releasing the browser without a synthetic continuation', async () => {
    let finishFrame
    runHttpsCallableFunction
        .mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    finishFrame = resolve
                })
        )
        .mockResolvedValue({ control: 'assistant', ready: true, resume: { projectId: 'p1', objectId: 'chat1' } })
    await render()
    let releasing
    act(() => {
        releasing = ref.current.releaseControl()
    })
    expect(runHttpsCallableFunction).toHaveBeenCalledTimes(1)
    await act(async () => {
        finishFrame({ control: 'user', ready: true })
        await releasing
    })
    expect(runHttpsCallableFunction.mock.calls.map(args => args[1].action)).toEqual(['frame', 'release'])
    expect(onControlChange).toHaveBeenLastCalledWith(false)
    expect(onResume).not.toHaveBeenCalled()
})

it('reports a failed browser hand-back so the message can stay unsent', async () => {
    runHttpsCallableFunction
        .mockResolvedValueOnce({ control: 'user', ready: true })
        .mockRejectedValueOnce(new Error('Offline'))
    await render()
    await act(async () => {
        await expect(ref.current.releaseControl()).rejects.toThrow('The browser is unavailable.')
    })
    expect(onResume).not.toHaveBeenCalled()
    expect(container.querySelector('[role="alert"]').textContent).toContain('Offline')
})

it('waits for taking browser control to finish even before the held state has rendered', async () => {
    let finishTake
    runHttpsCallableFunction
        .mockResolvedValueOnce({ control: 'assistant', ready: true })
        .mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    finishTake = resolve
                })
        )
        .mockResolvedValue({ control: 'assistant', ready: true })
    await render()
    act(() => [...container.querySelectorAll('button')].find(button => button.textContent === 'Take control').click())
    let releasing
    act(() => {
        releasing = ref.current.releaseControl()
    })
    expect(runHttpsCallableFunction).toHaveBeenCalledTimes(2)
    await act(async () => {
        finishTake({ control: 'user', ready: true })
        await releasing
    })
    expect(runHttpsCallableFunction.mock.calls.map(args => args[1].action)).toEqual(['frame', 'take', 'release'])
    expect(onControlChange).toHaveBeenLastCalledWith(false)
})

it('does not call the backend when the browser is already following the assistant', async () => {
    runHttpsCallableFunction.mockResolvedValue({ control: 'assistant', ready: true })
    await render()
    await act(async () => ref.current.releaseControl())
    expect(runHttpsCallableFunction).toHaveBeenCalledTimes(1)
})
