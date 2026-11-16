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

    it('makes the assistant a 44px avatar button that shows on every phone width', () => {
        const button = rule(
            '.anna-header-phone .anna-header-assistant,\n.anna-header-phone .anna-assistant-picker.anna-assistant-picker-avatar'
        )
        expect(button).toMatch(/width:\s*44px;/)
        expect(button).toMatch(/min-width:\s*44px;/)
        expect(button).toMatch(/height:\s*44px;/)
        expect(button).toMatch(/flex:\s*none;/)
        // The ≤360px rule hides the avatar next to a visible name; on a phone it is all there is.
        const avatar = rule('.anna-header-phone .anna-header-left .anna-small-avatar')
        expect(avatar).toMatch(/display:\s*grid;/)
        expect(css.indexOf('.anna-header-phone .anna-header-left .anna-small-avatar {')).toBeGreaterThan(
            css.indexOf('.anna-header .anna-small-avatar {')
        )
        // No name rules for phones any more.
        expect(css).not.toMatch(/\.anna-header-phone \.anna-brand/)
        // Disabled (offline, in a call): beats the shell's 0.45 for disabled buttons, stays recognisable.
        expect(rule('.anna-header-phone .anna-header-left .anna-assistant-picker-avatar:disabled')).toMatch(
            /opacity:\s*0\.6;/
        )
    })

    it('makes the screen picker an icon control with the native select over all of it', () => {
        expect(rule('.anna-header-phone .anna-header-picker')).toMatch(/flex:\s*none;/)
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

    // AT-3056 follow-up: both pickers read as "tap to choose" and look alike: a round 32px mark, the
    // same down-chevron, the same borderless 44px box, hover tint and focus ring.
    it('gives the assistant picker and the screen picker one shared look', () => {
        const left = '.anna-header-phone .anna-header-left .anna-assistant-picker-avatar'
        const right = '.anna-header-phone .anna-header-right .anna-header-picker'
        const box = rule(`${left},\n${right}`)
        expect(box).toMatch(/height:\s*44px;/)
        expect(box).toMatch(/min-width:\s*44px;/)
        expect(box).toMatch(/width:\s*auto;/)
        expect(box).toMatch(/border:\s*0;/)
        expect(box).toMatch(/border-radius:\s*8px;/)
        expect(box).toMatch(/background:\s*transparent;/)
        // It comes after the round 44px avatar button and the old picker box, so it wins.
        expect(css.indexOf(`${left},\n${right} {`)).toBeGreaterThan(
            css.indexOf('.anna-header-phone .anna-assistant-picker.anna-assistant-picker-avatar {')
        )
        expect(css.indexOf(`${left},\n${right} {`)).toBeGreaterThan(
            css.indexOf('.anna-header-phone .anna-header-picker {')
        )
        // The right's icon sits on a disc the size of the avatar, in the avatar's tint.
        const disc = rule(`${right} > .anna-header-picker-icon`)
        expect(disc).toMatch(/width:\s*32px;/)
        expect(disc).toMatch(/height:\s*32px;/)
        expect(disc).toMatch(/border-radius:\s*50%;/)
        expect(disc).toMatch(/background:\s*var\(--anna-tint\);/)
        expect(rule('.anna-small-avatar')).toMatch(/background:\s*var\(--anna-tint\);/)
        expect(rule('.anna-header-phone .anna-header-left .anna-small-avatar')).toMatch(/width:\s*32px;/)
        // One chevron style for both.
        const chevron = rule(
            '.anna-header-phone .anna-header-left .anna-assistant-picker-chevron,\n.anna-header-phone .anna-header-right .anna-assistant-picker-chevron'
        )
        expect(chevron).toMatch(/width:\s*18px;/)
        expect(chevron).toMatch(/color:\s*var\(--anna-muted\);/)
        // The same hover, and the same focus ring offset as the shell's buttons.
        expect(rule(`${left}:not(:disabled):hover,\n${right}:hover`)).toMatch(/background:\s*var\(--anna-tint\);/)
        expect(rule('.anna-header-phone .anna-header-picker:has(select:focus-visible)')).toMatch(
            /outline-offset:\s*3px;/
        )
        expect(css).toMatch(
            /\.anna-shell button:not\(\.anna-workspace-content \*\):focus-visible,[^{]*\{[^}]*outline-offset:\s*3px;/
        )
        // The round 44px avatar button stays for "Latest messages" (nothing else to pick).
        expect(
            rule(
                '.anna-header-phone .anna-header-assistant,\n.anna-header-phone .anna-assistant-picker.anna-assistant-picker-avatar'
            )
        ).toMatch(/border-radius:\s*50%;/)
    })

    it('reduces the focus task’s project to its dot on phones', () => {
        const narrow = container(480)
        expect(rule('.anna-header-phone .anna-focus-task-project-name', narrow)).toMatch(/display:\s*none;/)
        expect(rule('.anna-header-phone .anna-focus-task-project', narrow)).toMatch(/border:\s*0;/)
        expect(rule('.anna-header-phone .anna-focus-task-project')).toMatch(/max-width:\s*min\(96px, 30%\);/)
    })
})
