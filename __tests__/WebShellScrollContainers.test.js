const fs = require('fs')
const path = require('path')

// AT-2177: the sidebar navigation and the main content must scroll independently.
//
// They only can when the app shell has a DEFINITE height. react-navigation used to
// supply it (each screen lived in an absolutely-positioned card); migration Stage 2
// removed it, and with `min-height: 100%` alone the whole tree grew to its content,
// the document became the single scroller, and scrolling the main view dragged the
// sidebar off-screen. Guard the shell rule in both HTML templates so a future edit
// cannot silently reintroduce page-level scrolling.
const TEMPLATES = [
    ['web-bundler/index.html', 'deployed webpack pipeline template'],
    ['web/index.html', 'legacy expo template'],
]

const readShellRule = relativePath => {
    const html = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')
    // the `html, body, #root { ... }` block
    const match = html.match(/html,\s*body,\s*#root\s*\{([^}]*)\}/)
    return match ? match[1] : null
}

describe('Web app shell scroll containers', () => {
    test.each(TEMPLATES)('%s (%s) binds html, body and #root to the viewport height', relativePath => {
        const rule = readShellRule(relativePath)

        expect(rule).not.toBeNull()
        expect(rule).toMatch(/(^|[\s;])height:\s*100%\s*;/)
        // border-box keeps the safe-area padding on body from exceeding that height
        expect(rule).toMatch(/box-sizing:\s*border-box\s*;/)
    })

    test.each(TEMPLATES)('%s (%s) keeps body overflow as a safety valve', relativePath => {
        const html = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')
        const bodyRule = html.match(/\n\s*body\s*\{([^}]*)\}/)

        expect(bodyRule).not.toBeNull()
        expect(bodyRule[1]).toMatch(/overflow-y:\s*auto\s*;/)
    })
})
