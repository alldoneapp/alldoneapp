/**
 * AT-2178 browser-level regression test.
 *
 * Selecting text in a note and pressing the toolbar Task button must open the
 * create-task popup PRE-FILLED with the selected text, and it must STAY
 * pre-filled.
 *
 * Two earlier fixes (!244, !247) were validated only against helper unit tests
 * and component doubles, and both were inert in production, because the defect
 * was never in the selection resolution: the correct Delta always reached
 * TaskEditionMode. It was the create-task input itself that dropped it — see
 * the comment on `htmlRef` in CustomTextInput3.js. A unit test cannot see that;
 * it needs a real browser, a real Quill, a real ManageTaskModal (whose
 * CustomScrollView relayout is what interleaves with the pending state update)
 * and a real react-quill controlled-value cycle.
 *
 * The harness therefore bundles the REAL app modules with the app's own webpack
 * pipeline and drives them in Chromium:
 *   note ReactQuill + mentionsHelper.onChangeSelection
 *     -> EditorToolbarButton (real mousedown/click)
 *     -> mentionsHelper.captureSelectionFromEditor (as NotesEditorView.renderTask calls it)
 *     -> react-tiny-popover -> ManageTaskModal -> TaskArea -> TaskEditionMode
 *     -> CustomTextInput3
 * and asserts on the popup's rendered text, sampled over time so a value that
 * appears and is then wiped fails.
 *
 * Requirements (this does NOT run in CI's Node 14 Jest job):
 *   nvm use 22
 *   (cd web-bundler && npm install)
 *   npx playwright install chromium
 * Usage:
 *   node browser-tests/at2178/run.js
 */
const path = require('path')
const http = require('http')
const fs = require('fs')
const { execFileSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..', '..')
const BUILD_DIR = path.join(__dirname, '.build')
const ENTRY = path.join(__dirname, 'harness.entry.js')

const NOTE_TEXT = 'Alpha bravo charlie delta echo'
const SELECTED = 'bravo charlie'
// The popup is filled from a mount effect and could be wiped by any later
// render, so sample well past the last relayout instead of once.
const SAMPLES_MS = [150, 400, 1000, 2500]

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>AT-2178</title></head>
<body><div id="root"></div><script src="/harness.js"></script></body></html>`

function build() {
    const webpackBin = path.join(ROOT, 'web-bundler', 'node_modules', '.bin', 'webpack')
    if (!fs.existsSync(webpackBin)) {
        throw new Error('web-bundler dependencies are missing. Run: (cd web-bundler && npm install)')
    }
    execFileSync(
        webpackBin,
        [
            '--config',
            path.join(ROOT, 'browser-tests', 'webpack.harness.js'),
            '--mode',
            'development',
            '--env',
            `harnessEntry=${ENTRY}`,
            '--env',
            `harnessOut=${BUILD_DIR}`,
        ],
        { cwd: path.join(ROOT, 'web-bundler'), stdio: 'inherit' }
    )
    fs.writeFileSync(path.join(BUILD_DIR, 'index.html'), HTML)
}

function serve() {
    const server = http.createServer((req, res) => {
        const url = req.url.split('?')[0]
        const file = path.join(BUILD_DIR, url === '/' ? 'index.html' : url)
        if (!file.startsWith(BUILD_DIR) || !fs.existsSync(file)) {
            res.writeHead(404)
            res.end('not found')
            return
        }
        res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html' : 'application/javascript' })
        res.end(fs.readFileSync(file))
    })
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)))
}

function requirePlaywright() {
    try {
        return require('playwright')
    } catch (error) {
        const fallback = path.join(process.env.PLAYWRIGHT_HOME || '/home/user/repro', 'node_modules', 'playwright')
        return require(fallback)
    }
}

async function runCase(port, browser, mode) {
    const page = await browser.newPage()
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))

    await page.goto(`http://127.0.0.1:${port}/${mode}`)
    await page.waitForFunction(() => window.__ready === true && !!window.__noteRef)

    // Put text in the note and select part of it, which is what makes Quill emit
    // the selection-change the app listens to.
    await page.evaluate(text => window.__seedNote(text), NOTE_TEXT)
    await page.evaluate(
        ([index, length]) => {
            const editor = window.__noteRef.getEditor()
            editor.focus()
            editor.setSelection(index, length, 'user')
        },
        [NOTE_TEXT.indexOf(SELECTED), SELECTED.length]
    )

    // Press the toolbar Task button with a real mouse press.
    await page.click('#task-button')

    const samples = []
    let elapsed = 0
    for (const at of SAMPLES_MS) {
        await page.waitForTimeout(at - elapsed)
        elapsed = at
        samples.push({ at, texts: await page.evaluate(() => window.__popupTexts()) })
    }
    await page.close()
    return { mode, samples, pageErrors }
}

async function main() {
    build()
    const server = await serve()
    const port = server.address().port
    const { chromium } = requirePlaywright()
    const browser = await chromium.launch()

    // `modal` is the production-shaped tree (ManageTaskModal inside the popover);
    // `modal&churn` additionally keeps redux dispatching while the popup fills.
    const modes = ['?modal', '?modal&churn']
    const failures = []
    for (const mode of modes) {
        const result = await runCase(port, browser, mode)
        for (const sample of result.samples) {
            const visible = sample.texts.length ? sample.texts[sample.texts.length - 1] : null
            const ok = sample.texts.length > 0 && sample.texts.every(text => text === SELECTED)
            console.log(`${mode} @${sample.at}ms -> ${JSON.stringify(sample.texts)}${ok ? '' : '   <-- FAIL'}`)
            if (!ok) {
                failures.push(`${mode} @${sample.at}ms: create-task input was ${JSON.stringify(visible)}`)
            }
        }
        if (result.pageErrors.length) console.log(`${mode} page errors:`, result.pageErrors)
    }

    await browser.close()
    server.close()

    if (failures.length) {
        console.error(
            `\nFAIL: the create-task popup must be pre-filled with ${JSON.stringify(SELECTED)} and stay pre-filled.\n` +
                failures.map(f => `  - ${f}`).join('\n')
        )
        process.exit(1)
    }
    console.log(`\nPASS: create-task popup pre-filled with ${JSON.stringify(SELECTED)} at every sample.`)
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
