'use strict'

// NODE_PATH=<Playwright node_modules> node browser-tests/browser-cookie-consent/run.js
// Real DOM observation -> policy -> real click -> refreshed content. All pages are local fixtures
// fulfilled in memory; no third-party website or live consent is touched.
const assert = require('node:assert/strict')
const { chromium } = require('playwright')
const {
    describeElement,
    performClick,
    snapshotPage,
} = require('../../functions/Assistant/browser-worker/browserActions')
const { evaluateBrowserAction } = require('../../functions/Assistant/browser/browserPolicy')
const { buildBrowsingPolicy } = require('../../functions/Assistant/browser/browserAllowlist')

async function main() {
    const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true })
    try {
        const page = await browser.newPage()
        const policy = buildBrowsingPolicy({ mode: 'all_public' })
        const session = { page, policy }
        let html = ''
        await page.route('https://tickets.example/**', route => route.fulfill({ contentType: 'text/html', body: html }))
        const open = async (body, path = '/event') => {
            html = `<!doctype html><html><body>${body}</body></html>`
            await page.goto(`https://tickets.example${path}`)
            return snapshotPage(page)
        }
        const decisionFor = async name => {
            const snapshot = await snapshotPage(page)
            const element = snapshot.elements.find(item => item.name === name)
            assert.ok(element, `Missing control: ${name}`)
            const described = await describeElement(page, { ref: element.ref })
            assert.equal(described.ok, true)
            return {
                element,
                described,
                decision: evaluateBrowserAction({
                    action: 'click',
                    target: described.target,
                    pageUrl: page.url(),
                    policy,
                }),
            }
        }

        for (const [label, context] of [
            ['Accept all', 'We use cookies to personalize content.'],
            ['Alle akzeptieren', 'Wir verwenden Cookies.'],
            ['Aceptar todas', 'Utilizamos cookies.'],
            ['Save preferences', 'Cookie preferences'],
        ]) {
            await open(`
                <main hidden>Tickets available: 12</main>
                <section role="dialog" aria-label="Cookie preferences">
                    <p>${context}</p>
                    <form action="/preferences" method="post" onsubmit="event.preventDefault(); document.querySelector('main').hidden = false; this.closest('section').remove()">
                        <input type="checkbox" name="analytics" checked>
                        <div class="cookie-buttons"><button>${label}</button></div>
                    </form>
                </section>
            `)
            const { decision, element } = await decisionFor(label)
            assert.equal(decision.decision, 'allow', label)
            assert.deepEqual(decision.categories, ['cookie_consent'])
            const result = await performClick(session, { ref: element.ref })
            assert.equal(result.ok, true)
            assert.match(result.text, /Tickets available: 12/)
            assert.ok(!result.elements.some(item => item.name === label), 'Banner must disappear')
        }

        await open(
            `
            <form action="/account" method="post"><input type="password"><button>Sign in</button></form>
            <div id="cookie-banner"><p>We use cookies.</p><div class="cookie-buttons"><button type="button">Accept all</button></div></div>
        `,
            '/login'
        )
        assert.equal((await decisionFor('Accept all')).decision.decision, 'allow')
        assert.equal((await decisionFor('Sign in')).decision.category, 'login')

        for (const [fields, action] of [
            ['', '/checkout'],
            ['<input type="email" name="email">', '/preferences'],
        ]) {
            await open(
                `<div role="dialog"><p>Cookie preferences</p><form method="post" action="${action}">${fields}<button>Accept all</button></form></div>`
            )
            assert.equal((await decisionFor('Accept all')).decision.decision, 'requires_approval')
        }

        await open('<form method="post"><button>Save preferences</button></form><footer>We use cookies.</footer>')
        const unrelated = await decisionFor('Save preferences')
        assert.equal(unrelated.described.target.consentContextText, '')
        assert.equal(unrelated.decision.decision, 'requires_approval')
        console.log(
            'PASS: cookie banners in three languages, preference forms, nested containers, revealed content, login-page consent and unrelated/sensitive form gates.'
        )
    } finally {
        await browser.close()
    }
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
