'use strict'

// What the worker actually does to a page, and the two things it enforces that Functions cannot.
//
// 1. THE NETWORK GUARD. Every top-level document request — the navigation the tool asked for, every
//    redirect hop, and any navigation the PAGE starts by itself — is matched against the allowlist
//    carried in the signed token, and aborted when it does not match. That has to happen here
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

const { hostMatchesEntry, pathMatchesEntry } = require('./shared/browserAllowlist')

const REF_ATTRIBUTE = 'data-alldone-ref'
const INTERACTIVE_SELECTOR =
    'a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [role=textbox], [role=combobox], [role=checkbox], [role=radio], [role=tab], [role=option], [contenteditable=true]'

function isUrlAllowed(url, allowlist) {
    let parsed
    try {
        parsed = new URL(url)
    } catch (error) {
        return false
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false
    return (Array.isArray(allowlist) ? allowlist : []).some(
        entry => hostMatchesEntry(parsed.hostname, entry) && pathMatchesEntry(parsed.pathname, entry)
    )
}

/**
 * Install the guard once per session. Idempotent: re-routing a session that already has it would
 * double-count every request.
 */
async function ensureNetworkGuard(session, { allowlist, limits }) {
    if (session.guardInstalled) {
        session.allowlist = allowlist
        session.limits = limits
        return
    }
    session.allowlist = allowlist
    session.limits = limits
    session.guardInstalled = true

    await session.context.route('**/*', async route => {
        const request = route.request()
        const url = request.url()
        const isDocument = request.resourceType() === 'document'
        const maxRequests = Number(session.limits?.requests) || 250
        const maxBytes = Number(session.limits?.bytes) || 20 * 1024 * 1024

        if (isDocument && !isUrlAllowed(url, session.allowlist)) {
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
    const response = await session.page.goto(url, { waitUntil })
    const finalUrl = session.page.url()
    if (!isUrlAllowed(finalUrl, session.allowlist)) {
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
    const before = session.page.url()
    await session.page.click(target, { timeout: 10000 })
    await session.page.waitForLoadState('domcontentloaded').catch(() => {})
    const after = session.page.url()
    if (!isUrlAllowed(after, session.allowlist)) {
        await session.page.goBack().catch(() => {})
        return {
            ok: false,
            reason: 'navigated_off_allowlist',
            error: `The click navigated to ${after}, which is not on the allowlist.`,
        }
    }
    const snapshot = await snapshotPage(session.page, { maxChars })
    return { ok: true, navigated: before !== after, url: after, ...snapshot, snapshot }
}

async function performType(session, { ref, selector, text, submit, clearFirst, maxChars }) {
    const target = ref ? refSelector(ref) : selector
    if (clearFirst) await session.page.fill(target, '', { timeout: 10000 })
    await session.page.fill(target, String(text), { timeout: 10000 })
    if (submit) {
        await session.page.press(target, 'Enter', { timeout: 10000 })
        await session.page.waitForLoadState('domcontentloaded').catch(() => {})
    }
    const after = session.page.url()
    if (!isUrlAllowed(after, session.allowlist)) {
        return {
            ok: false,
            reason: 'navigated_off_allowlist',
            error: `Submitting navigated to ${after}, which is not on the allowlist.`,
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
