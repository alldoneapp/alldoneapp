jest.mock('../connectionHealth', () => ({
    startConnectionLatencySample: jest.fn(),
}))

import { startConnectionLatencySample } from '../connectionHealth'
import {
    __resetUserWaitConnectionForTests,
    finishAppBootConnectionWait,
    startAppBootConnectionWait,
} from './userWaitConnection'

describe('user wait connection timing', () => {
    const finish = jest.fn()

    beforeEach(() => {
        __resetUserWaitConnectionForTests()
        jest.clearAllMocks()
        startConnectionLatencySample.mockReturnValue(finish)
    })

    test('measures app boot once until the ready paint finishes it', () => {
        startAppBootConnectionWait()
        startAppBootConnectionWait()

        expect(startConnectionLatencySample).toHaveBeenCalledTimes(1)
        expect(startConnectionLatencySample).toHaveBeenCalledWith('app_boot')

        finishAppBootConnectionWait()
        finishAppBootConnectionWait()

        expect(finish).toHaveBeenCalledTimes(1)
    })

    test('can measure a later cold boot after the prior one completed', () => {
        startAppBootConnectionWait()
        finishAppBootConnectionWait()
        startAppBootConnectionWait()

        expect(startConnectionLatencySample).toHaveBeenCalledTimes(2)
    })
})
