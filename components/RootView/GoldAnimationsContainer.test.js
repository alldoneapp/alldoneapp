import React from 'react'
import renderer from 'react-test-renderer'

jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState), useDispatch: () => mockDispatch }))
jest.mock('../SettingsView/Profile/Achievements/Skyline/webglSupport', () => ({ canRenderSkyline: jest.fn() }))
jest.mock('../UIComponents/Ghosts/ghostAnimation', () => ({ currentReducedMotionPreference: jest.fn(() => false) }))
jest.mock('../TopBar/GoldChain', () => () => 'lottie-chain')
jest.mock('./GoldEarnedAnimation', () => () => 'lottie-coins')
jest.mock('./GoldCoins/goldCoinsOverlay', () => ({ launchGoldCoins: jest.fn() }))

const mockDispatch = jest.fn()
let mockState

const { canRenderSkyline } = require('../SettingsView/Profile/Achievements/Skyline/webglSupport')
const { currentReducedMotionPreference } = require('../UIComponents/Ghosts/ghostAnimation')
const GoldAnimationsContainer = require('./GoldAnimationsContainer').default

const render = () => {
    let tree
    renderer.act(() => {
        tree = renderer.create(<GoldAnimationsContainer />)
    })
    return tree
}

describe('gold reward animation', () => {
    beforeEach(() => {
        mockDispatch.mockClear()
        mockState = {
            showGoldChain: true,
            showGoldCoin: true,
            goldEarnedData: { goldEarned: 3, checkBoxId: 'task-1' },
            loggedUser: { gold: 100, sidebarExpanded: true },
            smallScreenNavigation: false,
        }
    })

    it('flies 3D coins where WebGL is available, and keeps the Gold icon visible', () => {
        canRenderSkyline.mockReturnValue(true)
        const tree = render()
        expect(tree.toJSON()).toBeNull()
        const types = mockDispatch.mock.calls.map(([action]) => action.type)
        expect(types).toEqual(expect.arrayContaining(['Hide gold chain', 'Hide gold coin']))
    })

    it('keeps the Lottie animations without WebGL', () => {
        canRenderSkyline.mockReturnValue(false)
        expect(render().toJSON()).toEqual(['lottie-chain', 'lottie-coins'])
    })

    it('keeps the Lottie animations under reduced motion', () => {
        canRenderSkyline.mockReturnValue(true)
        currentReducedMotionPreference.mockReturnValue(true)
        expect(render().toJSON()).toEqual(['lottie-chain', 'lottie-coins'])
        currentReducedMotionPreference.mockReturnValue(false)
    })
})
