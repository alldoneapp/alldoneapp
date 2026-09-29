import React from 'react'
import renderer, { act } from 'react-test-renderer'
import { ActivityIndicator } from 'react-native'

const mockMountThinkingView = jest.fn()
jest.mock('./loadThinkingStage', () => ({
    loadThinkingStage: jest.fn(() =>
        Promise.resolve({ mountThinkingView: (...args) => mockMountThinkingView(...args) })
    ),
}))
let mockWebGL = true
jest.mock('../../../../SettingsView/Profile/Achievements/Skyline/webglSupport', () => ({
    canRenderSkyline: () => mockWebGL,
}))
let mockReducedMotion = false
jest.mock('../../../../UIComponents/Ghosts/ghostAnimation', () => ({
    useReducedMotion: () => mockReducedMotion,
}))

import AssistantThinking3D, { useAssistantThinking3DEnabled } from './AssistantThinking3D'
import { loadThinkingStage } from './loadThinkingStage'
import { THINKING_ANIMATIONS, __resetThinkingAnimationChoiceForTests } from './thinkingAnimationChoice'

const hostNode = () => ({ appendChild: jest.fn() })
const flush = () => act(() => Promise.resolve())

describe('AssistantThinking3D', () => {
    beforeEach(() => {
        mockMountThinkingView.mockReset()
        mockWebGL = true
        mockReducedMotion = false
        __resetThinkingAnimationChoiceForTests()
        jest.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => jest.restoreAllMocks())

    test('shows the spinner until the first 3D frame is drawn, then only the scene', async () => {
        let options
        const unmountView = jest.fn()
        mockMountThinkingView.mockImplementation((host, opts) => {
            options = opts
            return unmountView
        })
        let tree
        await act(async () => {
            tree = renderer.create(<AssistantThinking3D appearance="dark" spinnerColor="#123" />, {
                createNodeMock: hostNode,
            })
        })
        await flush()
        expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1)
        expect(THINKING_ANIMATIONS).toContain(options.animation)
        expect(options.appearance).toBe('dark')

        act(() => options.onReady())
        expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(0)

        act(() => tree.unmount())
        expect(unmountView).toHaveBeenCalledTimes(1)
    })

    test('brings the spinner back if the scene fails', async () => {
        let options
        mockMountThinkingView.mockImplementation((host, opts) => {
            options = opts
            return () => {}
        })
        let tree
        await act(async () => {
            tree = renderer.create(<AssistantThinking3D />, { createNodeMock: hostNode })
        })
        await flush()
        act(() => options.onReady())
        act(() => options.onFailure(new Error('lost')))
        expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1)
    })

    test('keeps the spinner when the chunk cannot be loaded', async () => {
        loadThinkingStage.mockImplementationOnce(() => Promise.reject(new Error('offline')))
        let tree
        await act(async () => {
            tree = renderer.create(<AssistantThinking3D />, { createNodeMock: hostNode })
        })
        await flush()
        expect(mockMountThinkingView).not.toHaveBeenCalled()
        expect(tree.root.findAllByType(ActivityIndicator)).toHaveLength(1)
    })

    test('the placeholder hands its scene to the message card that replaces it', async () => {
        const animations = []
        mockMountThinkingView.mockImplementation((host, opts) => {
            animations.push(opts.animation)
            return () => {}
        })
        let tree
        await act(async () => {
            tree = renderer.create(<AssistantThinking3D key="placeholder" />, { createNodeMock: hostNode })
        })
        await flush()
        await act(async () => tree.update(<AssistantThinking3D key="message" />))
        await flush()
        expect(animations).toHaveLength(2)
        expect(animations[1]).toBe(animations[0])
    })

    test.each([
        ['WebGL and motion', true, false, true],
        ['no WebGL', false, false, false],
        ['reduced motion', true, true, false],
    ])('is enabled with %s: %s', (label, webgl, reduced, expected) => {
        mockWebGL = webgl
        mockReducedMotion = reduced
        let enabled
        const Probe = () => {
            enabled = useAssistantThinking3DEnabled()
            return null
        }
        renderer.create(<Probe />)
        expect(enabled).toBe(expected)
    })
})
