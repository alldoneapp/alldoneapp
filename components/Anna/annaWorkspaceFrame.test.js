/**
 * AT-2911 — the Alldone workspace beside the assistant chat is framed like a screen in a
 * monitor. jsdom computes no layout, so this pins the stylesheet contract; the geometry
 * itself (equal bezel at the column's outer bounds, horizontal-only padding, the floating
 * "+" 24px from the app's own edge) was measured in real Chromium against this file.
 */
const fs = require('fs')
const path = require('path')

const css = fs.readFileSync(path.join(__dirname, 'anna.css'), 'utf8')
const shellSource = fs.readFileSync(path.join(__dirname, 'AnnaShell.js'), 'utf8')
const frameBlock = css.slice(css.indexOf('/* AT-2911'), css.indexOf('.anna-working-label {'))

describe('assistant workspace monitor frame (AT-2911)', () => {
    it('draws one gray bezel width on all four edges from a single variable', () => {
        expect(frameBlock).toMatch(/--anna-workspace-bezel:\s*6px;/)
        expect(frameBlock).toMatch(/--anna-workspace-bezel-color:\s*var\(--anna-bezel\);/)
        expect(shellSource).toContain("'--anna-bezel': colors.Grey400")
        expect(frameBlock).toMatch(
            /border:\s*var\(--anna-workspace-bezel\)\s+solid\s+var\(--anna-workspace-bezel-color\);/
        )
        // No per-edge override may make one side thicker than the others.
        expect(frameBlock).not.toMatch(/border-(top|right|bottom|left)(-width)?:/)
    })

    it('puts the bezel on the outermost box of the workspace column, with no space around it', () => {
        expect(frameBlock).toMatch(
            /\.anna-zoom-active:not\(\.anna-chat-only\) \.anna-stage \{\s*border: var\(--anna-workspace-bezel\)/
        )
        const stageRule = frameBlock.match(/\.anna-zoom-active:not\(\.anna-chat-only\) \.anna-stage \{[^}]*\}/)[0]
        expect(stageRule).not.toMatch(/padding|margin/)
    })

    it('pads the app inside the bezel horizontally only', () => {
        expect(frameBlock).toMatch(
            /\.anna-stage > \.anna-workspace \{\s*padding-inline: var\(--anna-workspace-gutter\);\s*background: #fff;/
        )
        expect(frameBlock).not.toMatch(/padding-block|gutter-block|padding:\s/)
    })

    it('keeps the padding outside the measured workspace viewport', () => {
        // useWorkspaceViewportOwner measures .anna-workspace-content, which sits inside the
        // padded .anna-workspace — so the floating "+", inline fixed overlays and popover
        // bounds start at the app's own edge without any compensation of their own.
        expect(frameBlock).not.toMatch(/\.anna-workspace-content\s*\{[^}]*(padding|border|margin)/)
    })

    it('raises the working label from the bottom bezel, clear of the app top bar', () => {
        const notch = css.slice(css.indexOf('Rises from the middle of the bottom bezel'))
        const labelRule = notch.slice(0, notch.indexOf('}'))
        expect(labelRule).toMatch(/bottom: 0;/)
        expect(labelRule).not.toMatch(/^\s*top:/m)
        expect(labelRule).toMatch(/border-radius: 9px 9px 0 0;/)
    })
})
