const fs = require('fs')
const path = require('path')

import { CONTENT_MARGIN, CONTENT_MARGIN_TABLET } from '../styles/global'

// AT-3121: Alldone beside the chat with the "Anna on top" sidebar uses its pane's full width. The main
// views take their side margins from CSS variables with the old numbers as fallback, and only that
// pane sets them. jsdom does no cascade, so this pins the rules; AnnaShell.test.js pins the markup.
const css = fs.readFileSync(path.join(__dirname, 'anna.css'), 'utf8')
const rule = selector =>
    css.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? null

describe('the main views’ side margins', () => {
    it('keep 104px and 56px wherever nothing sets them', () => {
        expect(CONTENT_MARGIN).toBe('var(--ad-content-margin, 104px)')
        expect(CONTENT_MARGIN_TABLET).toBe('var(--ad-content-margin-tablet, 56px)')
    })

    it('shrink to 16px only in the pane beside the chat with the shell’s sidebar', () => {
        const pane = rule('.anna-shell.anna-shell-owns-sidebar .anna-workspace-content')
        expect(pane).toMatch(/--ad-content-margin:\s*16px;/)
        expect(pane).toMatch(/--ad-content-margin-tablet:\s*16px;/)
        expect(css.match(/--ad-content-margin:/g)).toHaveLength(1)
    })

    it('gives the screen’s X its own bar above the screen', () => {
        expect(rule('.anna-stage-bar')).toMatch(/flex:\s*none;/)
        expect(rule('.anna-stage-close')).not.toMatch(/position:\s*absolute/)
    })
})
