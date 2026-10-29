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
