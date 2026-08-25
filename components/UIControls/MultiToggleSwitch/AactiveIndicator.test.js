import React from 'react'
import { Animated } from 'react-native'
import renderer, { act } from 'react-test-renderer'
import { useSelector } from 'react-redux'

import AactiveIndicator from './AactiveIndicator'
import MyPlatform from '../../MyPlatform'

jest.mock('react-redux', () => ({ useSelector: jest.fn() }))
jest.mock('../../MyPlatform', () => ({
    __esModule: true,
    default: { getElementWidth: jest.fn() },
}))

describe('AactiveIndicator async measurement lifecycle', () => {
    let parallelSpy
    let animation

    beforeEach(() => {
        useSelector.mockImplementation(selector => selector({ smallScreenNavigation: false }))
        animation = { start: jest.fn(), stop: jest.fn() }
        parallelSpy = jest.spyOn(Animated, 'parallel').mockReturnValue(animation)
    })

    afterEach(() => {
        parallelSpy.mockRestore()
    })

    it('ignores a width measurement that resolves after unmount', async () => {
        let resolveWidth
        MyPlatform.getElementWidth.mockReturnValue(
            new Promise(resolve => {
                resolveWidth = resolve
            })
        )

        let tree
        act(() => {
            tree = renderer.create(
                <AactiveIndicator options={[{ text: 'One' }]} optionsRefs={[null]} currentIndex={0} />
            )
        })
        act(() => tree.unmount())

        await act(async () => {
            resolveWidth(80)
            await Promise.resolve()
        })

        expect(parallelSpy).not.toHaveBeenCalled()
    })

    it('stops an active indicator animation during unmount', async () => {
        MyPlatform.getElementWidth.mockResolvedValue(80)

        let tree
        await act(async () => {
            tree = renderer.create(
                <AactiveIndicator options={[{ text: 'One' }]} optionsRefs={[null]} currentIndex={0} />
            )
            await Promise.resolve()
        })

        expect(animation.start).toHaveBeenCalledTimes(1)
        act(() => tree.unmount())
        expect(animation.stop).toHaveBeenCalledTimes(1)
    })
})
