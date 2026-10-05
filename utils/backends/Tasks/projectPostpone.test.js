import moment from 'moment'
import { postponeProjectTasks } from './projectPostpone'
import { runHttpsCallableFunction } from '../firestore'

jest.mock('../firestore', () => ({ runHttpsCallableFunction: jest.fn().mockResolvedValue({ updatedTaskCount: 2 }) }))
jest.mock('../../redux/loadingOperation', () => ({ runWithLoading: (_source, work) => work() }))
jest.mock('uuid/v4', () => () => 'request-1')

it('sends a single authenticated callable with a stable request id and the local timezone', async () => {
    await expect(postponeProjectTasks('p1', 1234)).resolves.toEqual({ updatedTaskCount: 2 })
    expect(runHttpsCallableFunction).toHaveBeenLastCalledWith('postponeProjectTasksWithUndoSecondGen', {
        projectId: 'p1',
        requestId: 'request-1',
        mode: 'date',
        date: 1234,
        timezoneOffset: moment().utcOffset(),
    })
})

it('lets the cloud derive auto-postpone dates without sending a browser task list', async () => {
    await postponeProjectTasks('p1', undefined, 'auto')
    expect(runHttpsCallableFunction).toHaveBeenLastCalledWith('postponeProjectTasksWithUndoSecondGen', {
        projectId: 'p1',
        requestId: 'request-1',
        mode: 'auto',
        timezoneOffset: moment().utcOffset(),
    })
})

it('propagates an offline/server rejection to the picker', async () => {
    runHttpsCallableFunction.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'offline' }))
    await expect(postponeProjectTasks('p1', 1234)).rejects.toMatchObject({ code: 'offline' })
})
