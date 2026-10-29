const fs = require('fs')
const path = require('path')

// AT-2917: the Assistant Mode conversation scrolls vertically only. With `overflow: auto` on
// both axes, one message wider than a narrow pane (an image sized from the popover width, a
// file path in a list item) gave the whole timeline a sideways scroll range, and a horizontal
// trackpad swipe slid every message off the pane's left edge. Content is fixed at the source
// (CommentElementsParser, MessageItemBody); this pins the pane itself so the next overflowing
// component cannot do the same. `browser-tests/at2917` measures the real layout.
const css = fs.readFileSync(path.join(__dirname, 'anna.css'), 'utf8')
const rule = selector => {
    const match = css.match(new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')}\\s*\\{([^}]*)\\}`))
    return match ? match[1] : null
}

describe('Assistant Mode conversation horizontal overflow (AT-2917)', () => {
    test('the message list never scrolls sideways', () => {
        const messages = rule('.anna-messages')
        expect(messages).not.toBeNull()
        expect(messages).toMatch(/overflow-x:\s*hidden\s*;/)
        expect(messages).toMatch(/overflow-y:\s*auto\s*;/)
        expect(messages).not.toMatch(/(^|[\s;])overflow:\s*(auto|scroll)/)
    })
})

// AT-2918: an activity chip ("Mit Ziel verknüpft: <long goal name>") is one line with an ellipsis
// and never wider than its row. `browser-tests/at2917` measures it in a real browser.
describe('Assistant Mode activity chips (AT-2918)', () => {
    const block = selector => {
        const escaped = selector.replace(/[.>]/g, match => `\\${match}`).replace(/\s+/g, '\\s*')
        const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`))
        return match ? match[1] : null
    }

    test('chips are capped at the row width and may shrink', () => {
        const chips = css.match(/\n\.anna-activity-action,\n\.anna-activity-link\s*\{([^}]*)\}/)?.[1]
        expect(chips).toMatch(/max-width:\s*100%\s*;/)
        expect(chips).toMatch(/min-width:\s*0\s*;/)
        expect(chips).toMatch(/overflow:\s*hidden\s*;/)
        expect(chips).toMatch(/white-space:\s*nowrap\s*;/)
    })

    test('the action chip is a block with an ellipsis and is allowed to shrink', () => {
        const action = block('.anna-activity-actions > .anna-activity-action')
        expect(action).toMatch(/display:\s*block\s*;/)
        expect(action).toMatch(/text-overflow:\s*ellipsis\s*;/)
        expect(action).toMatch(/flex:\s*0 1 auto\s*;/)
        // The old `flex: none` on every chip is what kept them at their text width.
        expect(css).not.toMatch(/\.anna-activity-actions > span\s*\{[^}]*flex:\s*none/)
        expect(block('.anna-activity-link > .anna-activity-link-label')).toMatch(/text-overflow:\s*ellipsis\s*;/)
    })
})
