/**
 * @jest-environment jsdom
 */
import fs from 'fs'
import path from 'path'
import React from 'react'
import ReactDOM from 'react-dom'
import { act } from 'react-dom/test-utils'

const Popover = require('react-tiny-popover').default

describe('react-tiny-popover target tracking', () => {
    let host

    beforeEach(() => {
        global.ResizeObserver = class ResizeObserver {
            observe() {}
            unobserve() {}
            disconnect() {}
        }
        window.getSelection = () => ({ toString: () => '' })
        jest.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
            top: 40,
            left: 40,
            right: 140,
            bottom: 80,
            width: 100,
            height: 40,
        })
        host = document.createElement('div')
        document.body.appendChild(host)
    })

    afterEach(() => {
        act(() => {
            ReactDOM.unmountComponentAtNode(host)
        })
        host.remove()
        document.querySelectorAll('.react-tiny-popover-container').forEach(node => node.remove())
        jest.restoreAllMocks()
    })

    const renderPopover = disableTargetPositionListener => {
        act(() => {
            ReactDOM.render(
                <Popover
                    content={<div>comment popup</div>}
                    isOpen={true}
                    disableReposition={true}
                    disableTargetPositionListener={disableTargetPositionListener}
                    contentLocation={() => ({ top: 80, left: 100 })}
                >
                    <span />
                </Popover>,
                host
            )
        })
    }

    it('does not start the 10ms target poll when the fixed popup opts out', () => {
        const intervalSpy = jest.spyOn(window, 'setInterval')

        renderPopover(true)

        expect(intervalSpy).not.toHaveBeenCalled()
    })

    it('preserves target tracking for ordinary anchored popovers', () => {
        const intervalSpy = jest.spyOn(window, 'setInterval')

        renderPopover(false)

        expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 10)
    })

    it('enables the opt-out on the task comment popup only', () => {
        const source = fs.readFileSync(path.join(process.cwd(), 'components/Tags/TaskCommentsWrapper.js'), 'utf8')

        expect(source).toContain('disableTargetPositionListener={true}')
    })
})
