import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import WrapperMentionsModal from './WrapperMentionsModal'
import { setWorkspaceViewport } from '../../../utils/workspaceViewport'

jest.mock('react-redux', () => ({
    useDispatch: () => () => {},
    useSelector: selector => selector({ smallScreenNavigation: false }),
}))
jest.mock('./MentionsModal', () => () => <div>Mentions</div>)
jest.mock('../../ModalsManager/modalsManager', () => ({ exitsOpenModals: () => false }))
jest.mock('../../../utils/HelperFunctions', () => ({
    MENTION_MODAL_MIN_HEIGHT: 80,
    popoverToCenter: () => ({ top: 100, left: 100 }),
}))

let container, root
beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    setWorkspaceViewport({ top: 0, left: 600, width: 680, height: 800 })
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
        const popup = this.classList?.contains('react-tiny-popover-container')
        const width = popup ? 305 : 0
        const height = popup ? 240 : 0
        const top = parseFloat(this.style?.top) || 0
        const left = parseFloat(this.style?.left) || 0
        return { top, left, width, height, right: left + width, bottom: top + height }
    })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})
afterEach(() => {
    act(() => root.unmount())
    container.remove()
    setWorkspaceViewport(null)
    jest.restoreAllMocks()
    delete global.IS_REACT_ACT_ENVIRONMENT
})

const render = async getMentionViewport => {
    await act(async () => {
        root.render(
            <WrapperMentionsModal
                mentionText="task"
                projectId="p1"
                contentLocation={{ top: 600, left: 20 }}
                getMentionViewport={getMentionViewport}
            />
        )
        await new Promise(resolve => setTimeout(resolve, 50))
    })
    return document.querySelector('.react-tiny-popover-container').getBoundingClientRect()
}

it('anchors assistant mentions in the conversation rather than the Alldone workspace', async () => {
    const bounds = await render(() => ({
        active: true,
        top: 0,
        left: 0,
        width: 420,
        height: 800,
        right: 420,
        bottom: 800,
    }))
    expect(bounds.left).toBeLessThan(420)
    expect(bounds.right).toBeLessThanOrEqual(420)
    expect(bounds.top).toBeGreaterThanOrEqual(0)
    expect(bounds.bottom).toBeLessThanOrEqual(800)
})

it('preserves workspace placement for existing mention inputs', async () => {
    const bounds = await render()
    expect(bounds.left).toBeGreaterThanOrEqual(600)
    expect(bounds.right).toBeLessThanOrEqual(1280)
})
