import React from 'react'
import renderer from 'react-test-renderer'

jest.mock('react-redux', () => ({ useSelector: selector => selector(mockState), useDispatch: () => mockDispatch }))
jest.mock('../SettingsView/Profile/Achievements/Skyline/webglSupport', () => ({ canRenderSkyline: jest.fn() }))
jest.mock('../UIComponents/Ghosts/ghostAnimation', () => ({ currentReducedMotionPreference: jest.fn(() => false) }))
jest.mock('../TopBar/GoldChain', () => () => 'lottie-chain')
jest.mock('./GoldEarnedAnimation', () => () => 'lottie-coins')
const mockLaunchGoldCoins = jest.fn()
jest.mock('./GoldCoins/loadGoldCoinsOverlay', () => ({
    loadGoldCoinsOverlay: () => Promise.resolve({ launchGoldCoins: mockLaunchGoldCoins }),
}))

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

    it('launches one coin per gold earned from the checkbox to the Gold icon', async () => {
        canRenderSkyline.mockReturnValue(true)
        mockLaunchGoldCoins.mockClear()
        document.body.innerHTML = '<div check-box-id="task-1"></div><div id="goldArea"></div>'
        mockState.goldEarnedData = { goldEarned: 4, checkBoxId: 'task-1' }
        render()
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(mockLaunchGoldCoins).toHaveBeenCalledTimes(1)
        expect(mockLaunchGoldCoins.mock.calls[0][0].count).toBe(4)
        // A second mounted container (a detailed view) must not launch the same trigger again.
        render()
        await new Promise(resolve => setTimeout(resolve, 0))
        expect(mockLaunchGoldCoins).toHaveBeenCalledTimes(1)
        document.body.innerHTML = ''
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
