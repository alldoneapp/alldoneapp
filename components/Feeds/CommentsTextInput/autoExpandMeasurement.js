const sizesAreEqual = (first, second) =>
    first && second && first.width === second.width && first.height === second.height

export const getNaturalEditorSize = editorElement => ({
    width: editorElement.scrollWidth,
    height: editorElement.scrollHeight,
})

export const createAutoExpandMeasurement = ({ measure, report, requestFrame, cancelFrame }) => {
    let frame = null
    let lastSize = null

    const flush = () => {
        frame = null
        const size = measure()
        if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || sizesAreEqual(size, lastSize)) return

        lastSize = size
        report(size.width, size.height)
    }

    const request = () => {
        if (frame !== null) cancelFrame(frame)
        frame = requestFrame(flush)
    }

    const cancel = () => {
        if (frame !== null) cancelFrame(frame)
        frame = null
    }

    return { request, cancel }
}
