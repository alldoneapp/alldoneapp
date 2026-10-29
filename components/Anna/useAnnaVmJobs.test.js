import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import useAnnaVmJobs from './useAnnaVmJobs'
import { runHttpsCallableFunction } from '../../utils/backends/firestore'

let mockVisible
jest.mock('../../utils/backends/firestore', () => ({ runHttpsCallableFunction: jest.fn() }))
jest.mock('../../utils/appResume', () => ({
    subscribePageVisible: callback => {
        mockVisible = callback
        return jest.fn()
    },
}))
let latest, root, container
function Probe(props) {
    latest = useAnnaVmJobs(props.userId, props)
    return null
}
const render = props => act(async () => root.render(<Probe userId="u1" enabled selectedRunId={null} {...props} />))
beforeEach(() => {
    jest.useFakeTimers()
    jest.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    global.IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    runHttpsCallableFunction.mockReset().mockResolvedValue({ jobs: [] })
})
afterEach(() => {
    act(() => root.unmount())
    container.remove()
    jest.restoreAllMocks()
    jest.useRealTimers()
})

it('discovers jobs on entry, polls while visible, and refreshes on return', async () => {
    await render()
    expect(runHttpsCallableFunction).toHaveBeenCalledTimes(1)
    await act(async () => jest.advanceTimersByTime(15000))
    expect(runHttpsCallableFunction).toHaveBeenCalledTimes(2)
    jest.spyOn(document, 'hidden', 'get').mockReturnValue(true)
    await act(async () => jest.advanceTimersByTime(30000))
    expect(runHttpsCallableFunction).toHaveBeenCalledTimes(2)
    jest.spyOn(document, 'hidden', 'get').mockReturnValue(false)
    await act(async () => mockVisible())
    expect(runHttpsCallableFunction).toHaveBeenCalledTimes(3)
    await render({ enabled: false })
    await act(async () => jest.advanceTimersByTime(30000))
    expect(runHttpsCallableFunction).toHaveBeenCalledTimes(3)
})

it('keeps a selected completed result and removes it when selecting another surface', async () => {
    runHttpsCallableFunction.mockResolvedValue({
        jobs: [
            { id: 'r1', status: 'completed' },
            { id: 'r2', status: 'initiated' },
        ],
    })
    await render({ selectedRunId: 'r1' })
    expect(latest.jobs.map(job => job.id)).toEqual(['r1', 'r2'])
    expect(runHttpsCallableFunction).toHaveBeenLastCalledWith('listActiveVmJobsSecondGen', { selectedRunId: 'r1' })
    await render()
    expect(latest.jobs.map(job => job.id)).toEqual(['r2'])
})

it('ignores an old user’s late response after account changes', async () => {
    let resolveOld
    runHttpsCallableFunction.mockImplementationOnce(
        () =>
            new Promise(resolve => {
                resolveOld = resolve
            })
    )
    await render()
    await render({ userId: 'u2' })
    await act(async () => resolveOld({ jobs: [{ id: 'private', status: 'initiated' }] }))
    expect(latest.jobs).toEqual([])
})

it('makes discovery failures retryable and clears retained data on access failure', async () => {
    runHttpsCallableFunction.mockResolvedValueOnce({ jobs: [{ id: 'r1', status: 'initiated' }] })
    await render()
    runHttpsCallableFunction.mockRejectedValueOnce({ code: 'functions/permission-denied' })
    await act(async () => jest.advanceTimersByTime(15000))
    expect(latest.jobs).toEqual([])
    expect(latest.error).toBe(true)
    await act(async () => latest.retry())
    expect(latest.error).toBe(false)
})
