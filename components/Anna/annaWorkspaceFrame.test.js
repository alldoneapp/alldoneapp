/**
 * AT-2911 — the Alldone workspace beside the assistant chat is framed like a screen in a
 * monitor. jsdom computes no layout, so this pins the stylesheet contract; the geometry
 * itself (equal bezel, the floating "+" 24px from the screen's inner edge) was measured in
 * real Chromium against this file.
 */
const fs = require('fs')
const path = require('path')

const css = fs.readFileSync(path.join(__dirname, 'anna.css'), 'utf8')
const frameBlock = css.slice(css.indexOf('/* AT-2911'), css.indexOf('.anna-working-label {'))

describe('assistant workspace monitor frame (AT-2911)', () => {
    it('draws one bezel width on all four edges from a single variable', () => {
        expect(frameBlock).toMatch(/--anna-workspace-bezel:\s*6px;/)
        expect(frameBlock).toMatch(
            /border:\s*var\(--anna-workspace-bezel\)\s+solid\s+var\(--anna-workspace-bezel-color\);/
        )
        // No per-edge override may make one side thicker than the others.
        expect(frameBlock).not.toMatch(/border-(top|right|bottom|left)(-width)?:/)
    })

    it('leaves the space around the frame as plain white padding', () => {
        expect(frameBlock).toMatch(
            /\.anna-stage \{\s*padding: var\(--anna-workspace-gutter-block\) var\(--anna-workspace-gutter\);\s*background: #fff;/
        )
        expect(frameBlock).not.toContain('background: var(--anna-neutral)')
    })

    it('puts the bezel on the pane that owns the measured workspace viewport', () => {
        // useWorkspaceViewportOwner measures .anna-workspace-content, which sits inside the
        // bordered .anna-workspace — so the floating "+", inline fixed overlays and popover
        // bounds start at the bezel's inner edge without any compensation of their own.
        expect(frameBlock).toContain('.anna-stage > :is(.anna-workspace, .anna-vms, .anna-browser-surface)')
        expect(frameBlock).not.toMatch(/\.anna-workspace-content\s*\{[^}]*(padding|border|margin)/)
    })

    it('centres the working label on the top bezel', () => {
        expect(css).toMatch(
            /top: calc\(var\(--anna-workspace-gutter-block\) \+ var\(--anna-workspace-bezel\) \/ 2 - 10px\);[\s\S]*?height: 20px;/
        )
    })
})
