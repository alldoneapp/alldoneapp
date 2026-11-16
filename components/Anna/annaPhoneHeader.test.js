const fs = require('fs')
const path = require('path')

// AT-3056: on a phone the chat header's sides stay narrow and the focus task in the middle takes the
// rest. jsdom does no layout, so this pins the rules; AnnaShell.test.js pins the markup
// ("the compact phone chat header").
const css = fs.readFileSync(path.join(__dirname, 'anna.css'), 'utf8')
const escape = selector => selector.replace(/[.>:()]/g, match => `\\${match}`).replace(/\s+/g, '\\s+')
const rule = (selector, source = css) =>
    source.match(new RegExp(`(?:^|\\n)\\s*${escape(selector)}\\s*\\{([^}]*)\\}`))?.[1] ?? null
const container = width => {
    const start = css.indexOf(`@container anna-header (max-width: ${width}px) {\n    .anna-header-phone`)
    expect(start).toBeGreaterThan(-1)
    return css.slice(start, css.indexOf('\n}\n', start))
}

describe('the phone chat header (AT-3056)', () => {
    it('gives the middle the remaining width; desktop keeps its centred columns', () => {
        expect(rule('.anna-header.anna-header-phone')).toMatch(/grid-template-columns:\s*auto minmax\(0, 1fr\) auto;/)
        expect(rule('.anna-header-sidebar')).toMatch(
            /grid-template-columns:\s*minmax\(max-content, 1fr\) minmax\(0, auto\) minmax\(max-content, 1fr\);/
        )
        // The phone rule comes after the desktop one, so it wins at the same specificity.
        expect(css.indexOf('.anna-header.anna-header-phone {')).toBeGreaterThan(css.indexOf('.anna-header-sidebar {'))
        expect(rule('.anna-header-phone .anna-focus-task,\n.anna-header-phone .anna-focus-get')).toMatch(
            /max-width:\s*100%;/
        )
    })

    it('caps the short assistant name, tighter on the narrowest phones', () => {
        expect(rule('.anna-header-phone .anna-brand')).toMatch(/max-width:\s*88px;/)
        expect(rule('.anna-header-phone .anna-brand', container(360))).toMatch(/max-width:\s*64px;/)
        // The name itself still ends in an ellipsis on one line (AT-3040).
        expect(rule('.anna-brand')).toMatch(/text-overflow:\s*ellipsis;/)
    })

    it('makes the screen picker a 52x44 icon box with the native select over all of it', () => {
        const box = rule('.anna-header-phone .anna-header-picker')
        expect(box).toMatch(/width:\s*52px;/)
        expect(box).toMatch(/height:\s*44px;/)
        expect(box).toMatch(/flex:\s*none;/)
        const select = rule('.anna-header-phone .anna-header-picker select')
        expect(select).toMatch(/position:\s*absolute;/)
        expect(select).toMatch(/inset:\s*0;/)
        expect(select).toMatch(/opacity:\s*0;/)
        expect(select).toMatch(/font-size:\s*16px;/)
        // The anchor for the absolute select.
        expect(rule('.anna-header-picker')).toMatch(/position:\s*relative;/)
        // A keyboard user still sees where focus is.
        expect(rule('.anna-header-phone .anna-header-picker:has(select:focus-visible)')).toMatch(/outline:\s*2px solid/)
        // The icons are not stacked absolutely like the old chevron.
        expect(rule('.anna-header-phone .anna-header-picker > span')).toMatch(/position:\s*static;/)
    })

    it('reduces the focus task’s project to its dot on phones', () => {
        const narrow = container(480)
        expect(rule('.anna-header-phone .anna-focus-task-project-name', narrow)).toMatch(/display:\s*none;/)
        expect(rule('.anna-header-phone .anna-focus-task-project', narrow)).toMatch(/border:\s*0;/)
        expect(rule('.anna-header-phone .anna-focus-task-project')).toMatch(/max-width:\s*min\(96px, 30%\);/)
    })
})
