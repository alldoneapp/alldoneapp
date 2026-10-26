const {
    ARTIFACT_FRAME_PROTOCOL,
    FRAME_HEIGHT_SCRIPT,
    MAX_FRAME_CONTENT_HEIGHT,
    MIN_FRAME_CONTENT_HEIGHT,
    appendFrameHeightScript,
    readFrameHeightMessage,
    shouldReportFrameHeight,
} = require('./artifactFrameHeight')

const req = headers => ({ get: name => headers[name.toLowerCase()] })

describe('shouldReportFrameHeight', () => {
    it('is true only for an HTML document the browser loads into a frame', () => {
        expect(shouldReportFrameHeight(req({ 'sec-fetch-dest': 'iframe' }), 'text/html')).toBe(true)
        expect(shouldReportFrameHeight(req({ 'sec-fetch-dest': 'IFRAME' }), 'text/html')).toBe(true)
        expect(shouldReportFrameHeight({ headers: { 'sec-fetch-dest': 'iframe' } }, 'text/html')).toBe(true)
        expect(shouldReportFrameHeight(req({ 'sec-fetch-dest': 'document' }), 'text/html')).toBe(false)
        expect(shouldReportFrameHeight(req({}), 'text/html')).toBe(false)
        expect(shouldReportFrameHeight(req({ 'sec-fetch-dest': 'iframe' }), 'image/svg+xml')).toBe(false)
        expect(shouldReportFrameHeight(req({ 'sec-fetch-dest': 'iframe' }), 'application/pdf')).toBe(false)
    })
})

describe('appendFrameHeightScript', () => {
    it('keeps the stored bytes as they are and adds the script after them', () => {
        const latin1 = Buffer.from([0x3c, 0x70, 0x3e, 0xe9, 0x3c, 0x2f, 0x70, 0x3e]) // <p>é</p> in latin-1
        const out = appendFrameHeightScript(latin1)
        expect(out.subarray(0, latin1.length).equals(latin1)).toBe(true)
        expect(out.subarray(latin1.length).toString()).toContain(FRAME_HEIGHT_SCRIPT)
    })

    it('carries no closing script tag inside the script itself', () => {
        expect(FRAME_HEIGHT_SCRIPT).not.toMatch(/<\/script/i)
    })
})

describe('readFrameHeightMessage', () => {
    const message = height => ({ protocol: ARTIFACT_FRAME_PROTOCOL, type: 'height', height })

    it('accepts a height and clamps it', () => {
        expect(readFrameHeightMessage(message(812.2))).toBe(813)
        expect(readFrameHeightMessage(message(3))).toBe(MIN_FRAME_CONTENT_HEIGHT)
        expect(readFrameHeightMessage(message(1e9))).toBe(MAX_FRAME_CONTENT_HEIGHT)
    })

    it('rejects anything else', () => {
        expect(readFrameHeightMessage(null)).toBeNull()
        expect(readFrameHeightMessage('height')).toBeNull()
        expect(readFrameHeightMessage({ ...message(500), protocol: 'alldone-bridge-v1' })).toBeNull()
        expect(readFrameHeightMessage({ ...message(500), type: 'hello' })).toBeNull()
        expect(readFrameHeightMessage(message('lots'))).toBeNull()
        expect(readFrameHeightMessage(message(-5))).toBeNull()
        expect(readFrameHeightMessage(message(Infinity))).toBeNull()
    })
})

// The script running in a document of its own, with layout faked: jsdom computes none.
describe('the reporter script', () => {
    function load({ framed = true } = {}) {
        const { JSDOM } = require('jsdom')
        const dom = new JSDOM('<!doctype html><html><body style="margin:0"><div id="content"></div></body></html>', {
            runScripts: 'outside-only',
            pretendToBeVisual: true,
        })
        const { window } = dom
        const layout = { content: 300, view: 600 }
        Object.defineProperty(window.document.documentElement, 'clientHeight', { get: () => layout.view })
        Object.defineProperty(window, 'innerHeight', { get: () => layout.view, configurable: true })
        Object.defineProperty(window.document.documentElement, 'scrollHeight', {
            get: () => Math.max(layout.view, layout.content),
        })
        Object.defineProperty(window.document.body, 'scrollHeight', {
            get: () => Math.max(layout.view, layout.content),
        })
        window.document.body.getBoundingClientRect = () => ({ top: 0, bottom: layout.content })
        const posted = []
        const parent = framed ? { postMessage: data => posted.push(data) } : window
        Object.defineProperty(window, 'parent', { get: () => parent })
        window.requestAnimationFrame = fn => setTimeout(fn, 0)
        window.eval(FRAME_HEIGHT_SCRIPT)
        const flush = () => new Promise(resolve => setTimeout(resolve, 5))
        const changed = async () => {
            window.dispatchEvent(new window.Event('resize'))
            await flush()
        }
        return { window, layout, posted, flush, changed }
    }

    it('reports a shorter page at its height, and a taller one at its full height', async () => {
        const { layout, posted, flush, changed } = load()
        await flush()
        expect(posted).toEqual([{ protocol: ARTIFACT_FRAME_PROTOCOL, type: 'height', height: 300 }])

        layout.view = 300
        layout.content = 2400
        await changed()
        expect(posted[posted.length - 1].height).toBe(2400)

        // The frame grew to fit: nothing new to say.
        layout.view = 2400
        await changed()
        expect(posted).toHaveLength(2)

        // Content shrank.
        layout.content = 900
        await changed()
        expect(posted[posted.length - 1].height).toBe(900)
    })

    it('says nothing when it is not framed', async () => {
        const { posted, flush } = load({ framed: false })
        await flush()
        expect(posted).toEqual([])
    })

    it('stops following a page whose height follows its own viewport', async () => {
        const { layout, posted, flush, changed } = load()
        await flush()
        // min-height: calc(100vh + 40px): every time the frame grows, the page is 40px taller again.
        for (let step = 0; step < 30; step += 1) {
            layout.view = posted[posted.length - 1].height
            layout.content = layout.view + 40
            await changed()
        }
        expect(posted.length).toBeLessThan(10)
        const settled = posted.length
        layout.view = posted[posted.length - 1].height
        layout.content = layout.view + 40
        await changed()
        expect(posted).toHaveLength(settled)
    })

    it('settles instead of flipping between two heights', async () => {
        const { layout, posted, flush, changed } = load()
        await flush()
        // A page that is 800 tall in a short frame and 500 tall in a tall one.
        for (let step = 0; step < 20; step += 1) {
            layout.view = posted[posted.length - 1].height
            layout.content = layout.view < 700 ? 800 : 500
            await changed()
        }
        expect(posted.length).toBeLessThan(6)
        expect(posted[posted.length - 1].height).toBe(800)
    })
})
