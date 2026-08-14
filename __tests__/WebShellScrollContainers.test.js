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
const MANIFESTS = ['web-bundler/static/manifest.json', 'web/manifest.json']

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

    // AT-2248: the mobile virtual keyboard covers the layout viewport instead of
    // resizing it, so the shell above stays full height and every inner scroller
    // believes a composer behind the keyboard is visible. utils/virtualKeyboard.js
    // publishes the covered strip as --app-keyboard-inset + the app-keyboard-open
    // class; these rules are the half that actually shrinks the shell, and they
    // have to exist in BOTH templates or the deployed build silently loses it.
    test.each(TEMPLATES)('%s (%s) shrinks the shell by the virtual keyboard inset', relativePath => {
        const html = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')
        const htmlRule = html.match(/html\.app-keyboard-open\s*\{([^}]*)\}/)

        expect(htmlRule).not.toBeNull()
        expect(htmlRule[1]).toMatch(/height:\s*calc\(100%\s*-\s*var\(--app-keyboard-inset,\s*0px\)\)\s*;/)
        // min-height: 100% from the shared shell rule resolves against the FULL
        // viewport and would otherwise override the shrunken height outright.
        expect(htmlRule[1]).toMatch(/min-height:\s*0\s*;/)
    })

    test.each(TEMPLATES)('%s (%s) does not shrink body and #root a second time', relativePath => {
        const html = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')
        const descendantRule = html.match(/html\.app-keyboard-open body,\s*html\.app-keyboard-open #root\s*\{([^}]*)\}/)

        expect(descendantRule).not.toBeNull()
        // They resolve their 100% against the already-shrunken <html>; repeating
        // the calc here would subtract the keyboard twice.
        expect(descendantRule[1]).toMatch(/height:\s*100%\s*;/)
        expect(descendantRule[1]).not.toMatch(/--app-keyboard-inset/)
        expect(descendantRule[1]).toMatch(/min-height:\s*0\s*;/)
    })

    test.each(TEMPLATES)('%s (%s) does not double-count the bottom safe area with the keyboard', relativePath => {
        const html = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')
        const bodyRule = html.match(/html\.app-keyboard-open body\s*\{([^}]*)\}/)

        expect(bodyRule).not.toBeNull()
        expect(bodyRule[1]).toMatch(/padding-bottom:\s*0\s*!important\s*;/)
    })

    // The declarative half of the same fix: Android Chrome resizes the layout
    // viewport itself when asked to, which the JS side detects and stays out of.
    test.each(TEMPLATES)('%s (%s) asks Android to resize the content for the keyboard', relativePath => {
        const html = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')
        const viewportMeta = html.match(/<meta\s+name="viewport"\s+content="([^"]*)"/)

        expect(viewportMeta).not.toBeNull()
        expect(viewportMeta[1]).toMatch(/interactive-widget=resizes-content/)
    })

    test.each(TEMPLATES)('%s (%s) keeps body overflow as a safety valve', relativePath => {
        const html = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')
        const bodyRule = html.match(/\n\s*body\s*\{([^}]*)\}/)

        expect(bodyRule).not.toBeNull()
        expect(bodyRule[1]).toMatch(/overflow-y:\s*auto\s*;/)
    })

    test.each(TEMPLATES)('%s (%s) reserves every iOS safe-area edge in the app shell', relativePath => {
        const html = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')
        const bodyRule = html.match(/\n\s*body\s*\{([^}]*)\}/)

        expect(bodyRule).not.toBeNull()
        for (const side of ['top', 'right', 'bottom', 'left']) {
            expect(bodyRule[1]).toMatch(new RegExp(`padding-${side}:\\s*env\\(safe-area-inset-${side}\\)`))
        }
    })

    test.each(TEMPLATES)('%s (%s) configures a light standalone iOS status area', relativePath => {
        const html = fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8')

        expect(html).toMatch(/name="viewport"[^>]+viewport-fit=cover/)
        expect(html).toMatch(/name="theme-color"\s+content="#FFFFFF"/)
        expect(html).toMatch(/name="apple-mobile-web-app-capable"\s+content="yes"/)
        expect(html).toMatch(/name="apple-mobile-web-app-status-bar-style"\s+content="default"/)
        expect(html).not.toMatch(/navigator\.maxTouchPoints[\s\S]+background-color/)
    })
})

describe('PWA display configuration', () => {
    test.each(MANIFESTS)('%s uses standalone display and the app-shell color', relativePath => {
        const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8'))

        expect(manifest.display).toBe('standalone')
        expect(manifest.theme_color).toBe('#FFFFFF')
    })
})
