'use strict'

// What the worker actually does to a page, and the two things it enforces that Functions cannot.
//
// 1. THE NETWORK GUARD. Every top-level document request — the navigation the tool asked for, every
//    redirect hop, and any navigation the PAGE starts by itself — is checked against the browsing
//    policy carried in the signed token (mode + allowlist + denylist), and aborted when it is not
//    permitted. In `all_public` the allowlist stops being the gate but nothing else does: loopback,
//    private, link-local, CGNAT, IPv6-ULA, metadata, IP literals, single-label hosts and non-http(s)
//    schemes stay refused, which is what keeps a redirect to `http://169.254.169.254/` from
//    resolving into a page. That has to happen here
//    because redirects and page-initiated navigations do not go past Functions at all: a policy
//    that only checks the URL the model passed would be satisfied by `https://allowed.example`
//    redirecting to anywhere. Sub-resources (images, scripts, fonts from CDNs) are NOT restricted
//    to the allowlist — almost no site would render — but they are counted and capped.
//
// 2. THE DESCRIBE STEP. `describeElement` resolves a ref and reports what the element IS without
//    touching it: role, accessible name, input type, and the enclosing form's method, action and
//    submit labels. This is the input the central policy classifies, so it must be read out of the
//    live DOM here and never reconstructed from anything the model supplied.
//
// Element refs are attributes stamped during a snapshot (`data-alldone-ref`). They survive between
// tool calls for as long as the node does, and a stale ref resolves to nothing — which the policy
// turns into a refusal rather than a guess.

const { requireShared } = require('./sharedModules')

// The worker asks the SAME function Cloud Functions asks. It used to re-implement the match with
// `hostMatchesEntry`/`pathMatchesEntry`, which was correct for the allowlist and would have been
// silently wrong the moment a second mode existed: `all_public` is not "match nothing", it is
// "everything the safety checks let through", and those checks live in that function.
const { buildBrowsingPolicy, checkUrlAgainstAllowlist } = requireShared('browserAllowlist')

const REF_ATTRIBUTE = 'data-alldone-ref'
const INTERACTIVE_SELECTOR =
    'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=textbox], [role=combobox], [role=checkbox], [role=radio], [role=tab], [role=option], [contenteditable=true]'

/**
 * The network guard's verdict, and deliberately the same verdict the policy reached in Cloud
 * Functions: scheme, credentials, blocked hosts, IP literals, loopback / private / link-local /
 * CGNAT / IPv6-ULA / metadata, then the denylist, then the mode. A redirect hop and a
 * page-initiated navigation never pass through Functions at all, so this is the only place those
 * are checked — and in `all_public` it is the ONLY thing standing between a redirect and
 * `http://169.254.169.254/`.
 *
 * `policy` is what the signed token carried; a request with no policy is refused.
 */
function isUrlAllowed(url, policy) {
    if (!policy) return false
    return checkUrlAgainstAllowlist(url, policy).allowed === true
}

/**
 * Install the guard once per session. Idempotent: re-routing a session that already has it would
 * double-count every request.
 */
async function ensureNetworkGuard(session, { allowlist, denylist, accessMode, limits }) {
    const policy = buildBrowsingPolicy({ mode: accessMode, allowlist, denylist })
    if (session.guardInstalled) {
        session.policy = policy
        session.limits = limits
        return
    }
    session.policy = policy
    session.limits = limits
    session.guardInstalled = true

    await session.context.route('**/*', async route => {
        const request = route.request()
        const url = request.url()
        const isDocument = request.resourceType() === 'document'
        const maxRequests = Number(session.limits?.requests) || 250
        const maxBytes = Number(session.limits?.bytes) || 20 * 1024 * 1024

        if (isDocument && !isUrlAllowed(url, session.policy)) {
            session.usage.blockedRequests += 1
            session.lastBlockedNavigation = url
            await route.abort('blockedbyclient')
            return
        }
        if (session.usage.networkRequests >= maxRequests || session.usage.responseBytes >= maxBytes) {
            session.usage.blockedRequests += 1
            await route.abort('blockedbyclient')
            return
        }

        session.usage.networkRequests += 1
        await route.continue()
    })

    session.page.on('response', response => {
        const length = Number(response.headers()['content-length'])
        if (Number.isFinite(length) && length > 0) session.usage.responseBytes += length
    })

    // The route handler above does NOT see a redirect hop: `route.continue()` makes Chromium follow
    // a 3xx internally and interception is not re-run for the new request (verified against
    // Playwright 1.49 — the handler is called once, for the original URL). The `request` event IS
    // fired for every hop, so this is where a chain is actually watched.
    //
    // It cannot ABORT the hop — no Playwright API can, from here — so it records it and the action
    // functions below fail the whole navigation. That matters for two shapes the final-URL check
    // alone cannot catch: a chain that passes THROUGH an internal host and back out to a public one,
    // and a chain whose internal hop is what the page wanted all along. What it does not do is stop
    // the request from being issued; preventing that is the deployment's job (restricted egress),
    // and browser/README.md says so.
    session.page.on('request', request => {
        if (request.resourceType() !== 'document') return
        const url = request.url()
        if (url === 'about:blank' || isUrlAllowed(url, session.policy)) return
        session.disallowedHop = url
    })
    // A file chooser that is opened and never answered leaves the page waiting forever; refusing it
    // explicitly is also the honest answer, since the worker has no files to give.
    session.page.on('filechooser', chooser => {
        session.lastFileChooserRefusedAt = Date.now()
        chooser
            .page()
            .keyboard.press('Escape')
            .catch(() => {})
    })
}

/** The disallowed document hop seen since the last call, if any. Reading it clears it. */
function takeDisallowedHop(session) {
    const hop = session.disallowedHop || ''
    session.disallowedHop = ''
    return hop
}

function collectRedirectChain(response) {
    const chain = []
    let current = response
    let guard = 0
    while (current && guard < 20) {
        chain.unshift(current.url())
        const request = current.request()
        const redirectedFrom = request && request.redirectedFrom ? request.redirectedFrom() : null
        current = redirectedFrom ? redirectedFrom.response() : null
        guard += 1
    }
    return chain
}

async function snapshotPage(page, { maxChars = 16000 } = {}) {
    return page.evaluate(
        ({ refAttribute, interactiveSelector, limit }) => {
            const isVisible = element => {
                const style = window.getComputedStyle(element)
                if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)
                    return false
                const rect = element.getBoundingClientRect()
                return rect.width > 0 && rect.height > 0
            }
            const accessibleName = element => {
                const aria = element.getAttribute('aria-label')
                if (aria && aria.trim()) return aria.trim()
                const labelledBy = element.getAttribute('aria-labelledby')
                if (labelledBy) {
                    const labelText = labelledBy
                        .split(/\s+/)
                        .map(id => document.getElementById(id))
                        .filter(Boolean)
                        .map(node => node.textContent || '')
                        .join(' ')
                        .trim()
                    if (labelText) return labelText
                }
                if (element.id) {
                    const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`)
                    if (label && label.textContent.trim()) return label.textContent.trim()
                }
                const closestLabel = element.closest('label')
                if (closestLabel && closestLabel.textContent.trim()) return closestLabel.textContent.trim()
                const text = (element.innerText || element.textContent || '').trim()
                if (text) return text
                return (
                    element.getAttribute('title') ||
                    element.getAttribute('placeholder') ||
                    element.getAttribute('alt') ||
                    element.getAttribute('value') ||
                    ''
                ).trim()
            }

            let counter = 0
            const elements = []
            for (const element of document.querySelectorAll(interactiveSelector)) {
                if (elements.length >= 120) break
                if (!isVisible(element)) continue
                counter += 1
                const ref = `e${counter}`
                element.setAttribute(refAttribute, ref)
                const form = element.form || element.closest('form')
                elements.push({
                    ref,
                    role: element.getAttribute('role') || element.tagName.toLowerCase(),
                    name: accessibleName(element).slice(0, 200),
                    inputType: (element.getAttribute('type') || '').toLowerCase(),
                    disabled: element.disabled === true || element.getAttribute('aria-disabled') === 'true',
                    isSubmit:
                        element.tagName === 'BUTTON'
                            ? (element.getAttribute('type') || 'submit').toLowerCase() === 'submit' && !!form
                            : ['submit', 'image'].includes((element.getAttribute('type') || '').toLowerCase()),
                    href: element.tagName === 'A' ? element.getAttribute('href') || '' : '',
                })
            }

            const text = (document.body ? document.body.innerText || '' : '').replace(/\n{3,}/g, '\n\n')
            return {
                url: location.href,
                title: document.title || '',
                text: text.slice(0, limit),
                textTruncated: text.length > limit,
                elements,
                headings: Array.from(document.querySelectorAll('h1, h2, h3'))
                    .slice(0, 30)
                    .map(node => ({
                        level: node.tagName.toLowerCase(),
                        text: (node.innerText || '').trim().slice(0, 200),
                    })),
            }
        },
        { refAttribute: REF_ATTRIBUTE, interactiveSelector: INTERACTIVE_SELECTOR, limit: maxChars }
    )
}

function refSelector(ref) {
    return `[${REF_ATTRIBUTE}="${String(ref).replace(/"/g, '')}"]`
}

/**
 * Resolve a target and report what it is. Never clicks, never types, never focuses — a describe that
 * could change the page would make the policy's input a side effect of asking.
 */
async function describeElement(page, { ref = '', selector = '' }) {
    const target = ref ? refSelector(ref) : selector
    if (!target) return { ok: false, error: 'A ref or a selector is required.', reason: 'missing_target' }

    const descriptor = await page.evaluate(selectorValue => {
        const element = document.querySelector(selectorValue)
        if (!element) return null

        const attribute = name => (element.getAttribute(name) || '').trim()
        const form = element.form || element.closest('form')
        const submitLabels = form
            ? Array.from(form.querySelectorAll('button, input[type=submit], input[type=image]'))
                  .slice(0, 8)
                  .map(node =>
                      (node.innerText || node.getAttribute('value') || node.getAttribute('aria-label') || '').trim()
                  )
                  .filter(Boolean)
            : []
        const formFieldNames = form
            ? Array.from(form.querySelectorAll('input, select, textarea'))
                  .slice(0, 20)
                  .map(node => (node.getAttribute('name') || node.getAttribute('id') || '').trim())
                  .filter(Boolean)
            : []
        const tagName = element.tagName.toLowerCase()
        const inputType = attribute('type').toLowerCase()

        return {
            tagName,
            role: attribute('role') || tagName,
            name:
                (element.innerText || '').trim().slice(0, 200) ||
                attribute('aria-label') ||
                attribute('value') ||
                attribute('placeholder') ||
                attribute('title'),
            ariaLabel: attribute('aria-label'),
            title: attribute('title'),
            alt: attribute('alt'),
            placeholder: attribute('placeholder'),
            buttonValue: attribute('value').slice(0, 120),
            fieldName: attribute('name'),
            inputType,
            acceptsFiles: inputType === 'file',
            disabled: element.disabled === true || attribute('aria-disabled') === 'true',
            href: tagName === 'a' ? attribute('href') : '',
            isSubmit:
                tagName === 'button'
                    ? (attribute('type') || 'submit').toLowerCase() === 'submit' && !!form
                    : ['submit', 'image'].includes(inputType),
            formAction: form ? form.getAttribute('action') || location.href : '',
            formMethod: form ? (form.getAttribute('method') || 'get').toLowerCase() : '',
            formName: form ? form.getAttribute('name') || form.getAttribute('id') || '' : '',
            formRole: form ? form.getAttribute('role') || '' : '',
            formAriaLabel: form ? form.getAttribute('aria-label') || '' : '',
            formFieldNames,
            submitLabels,
            insideForm: !!form,
        }
    }, target)

    if (!descriptor) {
        return {
            ok: false,
            error: 'The element is no longer on the page. Take a fresh browser_inspect snapshot.',
            reason: 'target_unresolved',
        }
    }
    return { ok: true, target: descriptor, pageUrl: page.url() }
}

async function performNavigate(session, { url, waitUntil = 'domcontentloaded', maxChars }) {
    takeDisallowedHop(session)
    let response
    try {
        response = await session.page.goto(url, { waitUntil })
    } catch (error) {
        // A failed navigation leaves Chromium on its own error page, and that page COMMITS
        // asynchronously — the next `goto` then dies with "interrupted by another navigation to
        // chrome-error://chromewebdata/", i.e. one broken link makes the following, unrelated
        // navigation fail too. Park on about:blank so a run recovers from a dead page.
        await session.page.goto('about:blank').catch(() => {})
        const hopBeforeError = takeDisallowedHop(session)
        if (hopBeforeError) {
            return {
                ok: false,
                reason: 'redirect_off_allowlist',
                error: `The page redirected through ${hopBeforeError}, which is not permitted. Nothing was loaded.`,
            }
        }
        // The guard aborting a hop surfaces here as `net::ERR_BLOCKED_BY_CLIENT`, which on its own
        // reads like the site being down. Name the host that was refused instead — that is the one
        // fact the user needs to decide whether to allowlist it.
        const blocked = session.lastBlockedNavigation
        if (blocked && /ERR_BLOCKED_BY_CLIENT|ERR_FAILED/i.test(error.message || '')) {
            session.lastBlockedNavigation = null
            return {
                ok: false,
                reason: 'redirect_off_allowlist',
                error: `The page tried to send the browser to ${blocked}, which is not on the allowlist. Nothing was loaded.`,
            }
        }
        throw error
    }
    const finalUrl = session.page.url()
    const hop = takeDisallowedHop(session)
    if (hop) {
        await session.page.goto('about:blank').catch(() => {})
        return {
            ok: false,
            reason: 'redirect_off_allowlist',
            error: `The page redirected through ${hop}, which is not permitted. Nothing was loaded.`,
        }
    }
    if (!isUrlAllowed(finalUrl, session.policy)) {
        // A redirect chain that ended off-allowlist: the guard aborted the hop, so the page is
        // wherever it stopped. Report it rather than leaving the run on an unclassified page.
        await session.page.goto('about:blank').catch(() => {})
        return {
            ok: false,
            reason: 'redirect_off_allowlist',
            error: `The page redirected to ${finalUrl}, which is not on the allowlist. Nothing was loaded.`,
        }
    }
    const snapshot = await snapshotPage(session.page, { maxChars })
    return {
        ok: true,
        url,
        finalUrl,
        httpStatus: response ? response.status() : null,
        redirectChain: response ? collectRedirectChain(response) : [],
        ...snapshot,
        snapshot,
    }
}

async function performInspect(session, { maxChars }) {
    const snapshot = await snapshotPage(session.page, { maxChars })
    return { ok: true, ...snapshot, snapshot }
}

async function performClick(session, { ref, selector, maxChars }) {
    const target = ref ? refSelector(ref) : selector
    takeDisallowedHop(session)
    const before = session.page.url()
    await session.page.click(target, { timeout: 10000 })
    await session.page.waitForLoadState('domcontentloaded').catch(() => {})
    const after = session.page.url()
    const clickHop = takeDisallowedHop(session)
    if (clickHop || !isUrlAllowed(after, session.policy)) {
        await session.page.goBack().catch(() => {})
        return {
            ok: false,
            reason: 'navigated_off_allowlist',
            error: `The click navigated to ${clickHop || after}, which is not permitted.`,
        }
    }
    const snapshot = await snapshotPage(session.page, { maxChars })
    return { ok: true, navigated: before !== after, url: after, ...snapshot, snapshot }
}

async function performType(session, { ref, selector, text, submit, clearFirst, maxChars }) {
    const target = ref ? refSelector(ref) : selector
    takeDisallowedHop(session)
    if (clearFirst) await session.page.fill(target, '', { timeout: 10000 })
    await session.page.fill(target, String(text), { timeout: 10000 })
    if (submit) {
        await session.page.press(target, 'Enter', { timeout: 10000 })
        await session.page.waitForLoadState('domcontentloaded').catch(() => {})
    }
    const after = session.page.url()
    const submitHop = takeDisallowedHop(session)
    if (submitHop || !isUrlAllowed(after, session.policy)) {
        return {
            ok: false,
            reason: 'navigated_off_allowlist',
            error: `Submitting navigated to ${submitHop || after}, which is not permitted.`,
        }
    }
    const snapshot = await snapshotPage(session.page, { maxChars })
    return { ok: true, url: after, ...snapshot, snapshot }
}

async function performWait(session, { ms, selector, state }) {
    const startedAt = Date.now()
    if (selector) {
        await session.page.waitForSelector(selector, {
            state: state === 'hidden' ? 'hidden' : 'visible',
            timeout: 15000,
        })
    } else {
        await session.page.waitForTimeout(Math.min(Math.max(Number(ms) || 0, 0), 15000))
    }
    return { ok: true, url: session.page.url(), waitedMs: Date.now() - startedAt }
}

async function performScreenshot(session, { fullPage }) {
    const buffer = await session.page.screenshot({ fullPage: fullPage === true, type: 'png' })
    return {
        ok: true,
        url: session.page.url(),
        title: await session.page.title().catch(() => ''),
        screenshotBase64: buffer.toString('base64'),
    }
}

module.exports = {
    INTERACTIVE_SELECTOR,
    takeDisallowedHop,
    REF_ATTRIBUTE,
    describeElement,
    ensureNetworkGuard,
    isUrlAllowed,
    performClick,
    performInspect,
    performNavigate,
    performScreenshot,
    performType,
    performWait,
    refSelector,
    snapshotPage,
}
