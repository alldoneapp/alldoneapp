/**
 * AT-3032 — the project chip's name in the Anna composer renders at 13px. The size must sit on
 * `.anna-project-chip-name`: `.anna-shell button:not(.anna-workspace-content *) { font: inherit }`
 * outranks `.anna-project-chip`, so a font-size on the button is silently ignored (it rendered at
 * the composer's 16px and cut "Automatisch" to "Automa…").
 */
import fs from 'fs'
import path from 'path'

const css = fs.readFileSync(path.join(__dirname, 'anna.css'), 'utf8')
const rule = selector => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = css.match(new RegExp(`(?:^|\\n)${escaped} \\{([^}]*)\\}`))
    return match ? match[1] : null
}

describe('Anna project chip text', () => {
    it('sizes the name, where the shell button reset cannot override it', () => {
        const name = rule('.anna-project-chip-name')
        expect(name).not.toBeNull()
        expect(name).toMatch(/font-size: 13px;/)
        expect(name).toMatch(/text-overflow: ellipsis;/)
    })

    it('keeps no dead font-size on the chip button itself', () => {
        const chip = rule('.anna-project-chip')
        expect(chip).not.toBeNull()
        expect(chip).toMatch(/height: 32px;/)
        expect(chip).not.toMatch(/font-size/)
    })

    it('still has the shell-wide button reset this works around', () => {
        expect(css).toMatch(/\.anna-shell button:not\(\.anna-workspace-content \*\),[^{]*\{\s*font: inherit;/)
    })
})
