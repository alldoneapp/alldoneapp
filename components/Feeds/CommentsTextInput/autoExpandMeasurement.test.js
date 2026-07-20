import { createAutoExpandMeasurement, getNaturalEditorSize } from './autoExpandMeasurement'

describe('auto-expand content measurement', () => {
    const createFrameQueue = () => {
        let nextId = 0
        const callbacks = new Map()
        return {
            requestFrame: callback => {
                const id = ++nextId
                callbacks.set(id, callback)
                return id
            },
            cancelFrame: id => callbacks.delete(id),
            flush: () => {
                const pending = [...callbacks.values()]
                callbacks.clear()
                pending.forEach(callback => callback())
            },
        }
    }

    it('measures the natural editor content instead of its constrained wrapper', () => {
        const editor = { scrollWidth: 280, scrollHeight: 136, clientHeight: 120 }

        expect(getNaturalEditorSize(editor)).toEqual({ width: 280, height: 136 })
    })

    it('coalesces rapid typing and deletion into the latest browser layout', () => {
        const frames = createFrameQueue()
        const report = jest.fn()
        let size = { width: 280, height: 102 }
        const measurement = createAutoExpandMeasurement({
            measure: () => size,
            report,
            requestFrame: frames.requestFrame,
            cancelFrame: frames.cancelFrame,
        })

        measurement.request()
        size = { width: 280, height: 136 }
        measurement.request()
        size = { width: 280, height: 68 }
        measurement.request()
        frames.flush()

        expect(report).toHaveBeenCalledTimes(1)
        expect(report).toHaveBeenCalledWith(280, 68)
    })

    it('does not report ResizeObserver echoes caused by applying the measured height', () => {
        const frames = createFrameQueue()
        const report = jest.fn()
        const size = { width: 280, height: 121 }
        const measurement = createAutoExpandMeasurement({
            measure: () => size,
            report,
            requestFrame: frames.requestFrame,
            cancelFrame: frames.cancelFrame,
        })

        measurement.request()
        frames.flush()
        measurement.request()
        frames.flush()
        measurement.request()
        frames.flush()

        expect(report).toHaveBeenCalledTimes(1)
    })

    it('remeasures wrapped lines after a width-only layout change', () => {
        const frames = createFrameQueue()
        const report = jest.fn()
        let size = { width: 320, height: 68 }
        const measurement = createAutoExpandMeasurement({
            measure: () => size,
            report,
            requestFrame: frames.requestFrame,
            cancelFrame: frames.cancelFrame,
        })

        measurement.request()
        frames.flush()
        size = { width: 240, height: 102 }
        measurement.request()
        frames.flush()

        expect(report.mock.calls).toEqual([
            [320, 68],
            [240, 102],
        ])
    })
})
