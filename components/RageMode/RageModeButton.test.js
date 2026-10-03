import React from 'react'
import renderer, { act } from 'react-test-renderer'

let mockState
let mockEnabled
let mockWebGl
let mockReducedMotion
const mockStart = jest.fn()
const mockStop = jest.fn()

jest.mock('react-redux', () => ({
    useSelector: selector => selector(mockState),
}))
jest.mock('../Icon', () => 'Icon')
jest.mock('../../redux/store', () => ({ __esModule: true, default: { getState: () => mockState } }))
jest.mock('../../i18n/TranslationService', () => ({ translate: key => key }))
jest.mock('../SettingsView/Profile/Achievements/Skyline/webglSupport', () => ({
    canRenderSkyline: () => mockWebGl,
}))
jest.mock('../UIComponents/Ghosts/ghostAnimation', () => ({ useReducedMotion: () => mockReducedMotion }))
jest.mock('./rageModeFlag', () => ({ isRageModeEnabled: () => mockEnabled }))
jest.mock('./loadRageArena', () => ({
    loadRageArena: () => Promise.resolve({ startRageArena: (...args) => mockStart(...args) }),
}))

const RageModeButton = require('./RageModeButton').default
const { RAGE_ACTIVE_COLOR } = require('./RageModeButton')

const render = () => {
    let component
    act(() => {
        component = renderer.create(<RageModeButton color="grey" />)
    })
    return component
}

const flush = () => act(() => Promise.resolve())

describe('RageModeButton', () => {
    beforeEach(() => {
        mockState = { loggedUser: { isAnonymous: false } }
        mockEnabled = true
        mockWebGl = true
        mockReducedMotion = false
        mockStart.mockReset()
        mockStop.mockReset()
        mockStart.mockImplementation(() => ({ stop: mockStop }))
    })

    it('shows the crosshair when the device opted in', () => {
        expect(render().root.findAllByType('Icon')).toHaveLength(1)
    })

    it.each([
        ['the flag is off', () => (mockEnabled = false)],
        ['the viewer is anonymous', () => (mockState.loggedUser.isAnonymous = true)],
        ['WebGL is unavailable', () => (mockWebGl = false)],
        ['reduced motion is on', () => (mockReducedMotion = true)],
    ])('renders nothing when %s', (_, arrange) => {
        arrange()
        expect(render().toJSON()).toBeNull()
    })

    it('opens the arena with translated strings and turns red while it runs', async () => {
        const component = render()
        const button = component.root.findByProps({ accessibilityLabel: 'Rage mode' })
        act(() => button.props.onPress())
        await flush()

        expect(mockStart).toHaveBeenCalledTimes(1)
        const options = mockStart.mock.calls[0][0]
        expect(options.strings).toEqual(expect.objectContaining({ title: 'Rage mode', exitHint: 'Esc to exit' }))
        expect(component.root.findByType('Icon').props.color).toBe(RAGE_ACTIVE_COLOR)

        act(() => options.onExit())
        expect(component.root.findByType('Icon').props.color).toBe('grey')
    })

    it("hands the arena each project's marker colour, read from the store when asked", async () => {
        const { PROJECT_COLOR_SYSTEM } = require('../../Themes/Modern/ProjectColors')
        const colorKey = Object.keys(PROJECT_COLOR_SYSTEM)[0]
        const component = render()
        act(() => component.root.findByProps({ accessibilityLabel: 'Rage mode' }).props.onPress())
        await flush()
        const { services } = mockStart.mock.calls[0][0]
        mockState.loggedUserProjectsMap = { p1: { color: colorKey } }
        expect(services.getProjectColor('p1')).toBe(PROJECT_COLOR_SYSTEM[colorKey].MARKER)
        expect(services.getProjectColor('missing')).toBeNull()
    })

    it('does not open a second arena while one is running', async () => {
        const component = render()
        const button = component.root.findByProps({ accessibilityLabel: 'Rage mode' })
        act(() => button.props.onPress())
        await flush()
        act(() => component.root.findByProps({ accessibilityLabel: 'Rage mode' }).props.onPress())
        await flush()
        expect(mockStart).toHaveBeenCalledTimes(1)
    })

    it('closes a running arena at once when the button unmounts', async () => {
        const component = render()
        act(() => component.root.findByProps({ accessibilityLabel: 'Rage mode' }).props.onPress())
        await flush()
        act(() => component.unmount())
        expect(mockStop).toHaveBeenCalledWith({ immediate: true })
    })
})
