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

// AT-3032 (follow-up): the chip moved out of the toolbar onto the field's top edge, half over it.
describe('Anna project chip on the composer edge', () => {
    it('centres the chip on the field border, aligned with the +', () => {
        const slot = rule('.anna-composer-project')
        expect(slot).toMatch(/position: absolute;/)
        expect(slot).toMatch(/left: 12px;/)
        expect(slot).toMatch(/transform: translateY\(-50%\);/)
        expect(rule('.anna-composer-project:empty')).toMatch(/display: none;/)
    })

    it('reserves room above and below the edge only while a chip is shown', () => {
        // Half the 32px chip above the field, the other half plus a gap inside its padding.
        expect(rule('.anna-composer-slot:has(.anna-project-chip)')).toMatch(/margin-top: 16px;/)
        expect(rule('.anna-composer-field:has(.anna-project-chip)')).toMatch(/padding-top: 22px;/)
        expect(rule('.anna-composer-field')).toMatch(/position: relative;/)
    })
})

it('keeps the edge chip out of the stacking order, so popups (Templates) cover it', () => {
    expect(rule('.anna-composer-project')).not.toMatch(/^\s*z-index:/m)
})
