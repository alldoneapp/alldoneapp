const fs = require('fs')
const path = require('path')

// AT-3060: the desktop chat header's screen picker ("Chat" / "Alldone" / "Browser" …, AnnaScreenPicker)
// has no outer border, like the phone header's pickers (AT-3056 follow-up). jsdom does no layout or
// cascade, so this pins the rules; AnnaShell.test.js pins the markup and the menu behaviour.
const css = fs.readFileSync(path.join(__dirname, 'anna.css'), 'utf8')
const escape = selector => selector.replace(/[.*+?^${}()|[\]\\:>'=]/g, '\\$&').replace(/\s+/g, '\\s+')
const rule = selector => css.match(new RegExp(`(?:^|\\n)\\s*${escape(selector)}\\s*\\{([^}]*)\\}`))?.[1] ?? null
const phonePicker = rule(
    '.anna-header-phone .anna-header-left .anna-assistant-picker-avatar,\n.anna-header-phone .anna-header-right .anna-header-picker'
)
const phoneHover = rule(
    '.anna-header-phone .anna-header-left .anna-assistant-picker-avatar:not(:disabled):hover,\n.anna-header-phone .anna-header-right .anna-header-picker:hover'
)

describe('the desktop screen picker (AT-3060)', () => {
    const button = rule('.anna-screen-picker')
    const active = rule(".anna-screen-picker:hover,\n.anna-screen-picker[aria-expanded='true']")

    it('rests borderless and transparent, as the phone pickers do', () => {
        expect(button).not.toBeNull()
        expect(button).toMatch(/border:\s*0;/)
        expect(button).toMatch(/background:\s*transparent;/)
        expect(button).not.toMatch(/var\(--anna-border\)/)
        expect(button).not.toMatch(/var\(--ad-Surface/)
        // The same box language as the phone header's pickers.
        expect(phonePicker).toMatch(/border:\s*0;/)
        expect(phonePicker).toMatch(/background:\s*transparent;/)
        expect(button).toMatch(/border-radius:\s*8px;/)
        expect(phonePicker).toMatch(/border-radius:\s*8px;/)
    })

    it('tints on hover and while its menu is open instead of bringing a border back', () => {
        expect(active).toMatch(/background:\s*var\(--anna-tint\);/)
        expect(active).toMatch(/color:\s*var\(--anna-accent\);/)
        expect(active).not.toMatch(/border/)
        expect(phoneHover).toMatch(/background:\s*var\(--anna-tint\);/)
        // No rule anywhere gives the picker an outline or border back outside keyboard focus.
        const pickerRules = [...css.matchAll(/([^{}]*\.anna-screen-picker[^{}]*)\{([^}]*)\}/g)]
        expect(pickerRules.length).toBeGreaterThan(0)
        pickerRules.forEach(([, , body]) => {
            const values = [...body.matchAll(/(?:^|\s)(?:border(?:-color|-width|-style)?|outline)\s*:\s*([^;]*);/g)]
            values.forEach(([, value]) => expect(value.trim()).toMatch(/^(0|none)$/))
        })
    })

    it("keeps the keyboard focus ring from the shell's focus-visible rule", () => {
        expect(
            rule(
                '.anna-shell button:not(.anna-workspace-content *, .anna-shell-sidebar *):focus-visible,\n.anna-shell a:not(.anna-workspace-content *, .anna-shell-sidebar *):focus-visible,\n.anna-shell textarea:not(.anna-workspace-content *, .anna-shell-sidebar *):focus-visible'
            )
        ).toMatch(/outline:\s*2px solid var\(--anna-accent\);/)
    })
})
