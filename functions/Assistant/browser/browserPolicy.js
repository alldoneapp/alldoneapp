'use strict'

// The central policy. Every browser action passes through `evaluateBrowserAction` exactly once, and
// nothing downstream may relax what it decides.
//
// The bypass this file exists to close: the objective lists the operations that must never happen
// without an explicit human approval (login, file upload, booking, payment, submitting/publishing,
// deleting) — but the tool surface is `click` and `type`, which can perform every one of them
// without naming any of them. A gate that reads the model's own description of what it is about to
// do is therefore worthless: the model would only have to describe a purchase as "clicking the
// green button". So the classification here runs on the OBSERVED element, resolved by the worker
// out of the live DOM and the accessibility tree immediately before the action — role, accessible
// name, input type, the enclosing form's method and action, the labels of that form's submit
// controls, and the page URL. `browserSession.js` enforces the ordering (describe → policy → act);
// this module never trusts a field the model could have written.
//
// Three further rules shape it:
//
// 1. Anything a submit could be, it is. A form submission with no recognisable category is still
//    `submit_publish` and still pauses — read-only by default, since the failure of guessing wrong
//    in the permissive direction is a booking somebody did not make.
// 2. A GET search form is the one carve-out (`search_submit`). It changes nothing on the far side,
//    and without it the feature cannot answer the question it exists for ("are there still tickets
//    for that date?"), because that answer lives behind a search box. It only applies when NO
//    sensitive category matched.
// 3. Approval is an answer to a specific question, not a mode. A grant is bound to a signature over
//    (action, category, host, element shape), so approving "click 'Book now' on that host" never
//    silently also approves "click 'Delete account'".

const crypto = require('crypto')

const { DENY_REASONS, isSensitiveCategory } = require('./browserToolContract')
const { checkUrlAgainstAllowlist } = require('./browserAllowlist')
const { containsLikelySecret } = require('./browserRedaction')

/** Lowercase and fold diacritics so "Löschen" and "Loschen" are one pattern, in three languages. */
function normalizeText(value) {
    return String(value === null || value === undefined ? '' : value)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()
}

function buildMatcher(terms) {
    const alternation = terms
        .map(term =>
            normalizeText(term)
                .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
                .replace(/ /g, '\\s+')
        )
        .sort((first, second) => second.length - first.length)
        .join('|')
    return new RegExp(`(?:^|[^a-z0-9])(?:${alternation})(?:[^a-z0-9]|$)`, 'i')
}

// English / German / Spanish, because the app ships in those three and the button a European
// ticket shop renders is not going to be in English.
const CATEGORY_TERMS = {
    login: [
        'login',
        'log in',
        'sign in',
        'signin',
        'sign up',
        'signup',
        'register',
        'anmelden',
        'einloggen',
        'registrieren',
        'passwort',
        'password',
        'kennwort',
        'contrasena',
        'iniciar sesion',
        'acceder',
        'registrarse',
        'authenticate',
        'authentifizieren',
        'verifizierungscode',
        'verification code',
        'one time code',
        '2fa',
        'mfa',
    ],
    file_upload: [
        'upload',
        'hochladen',
        'datei auswahlen',
        'datei hochladen',
        'choose file',
        'select file',
        'browse files',
        'attach',
        'anhang',
        'anhangen',
        'subir',
        'adjuntar',
        'cargar archivo',
    ],
    booking: [
        'book',
        'book now',
        'booking',
        'buchen',
        'jetzt buchen',
        'reservieren',
        'reservation',
        'reserve',
        'reservar',
        'termin vereinbaren',
        'termin buchen',
        'appointment',
        'rsvp',
        'tisch reservieren',
        'platz reservieren',
    ],
    payment: [
        'pay',
        'pay now',
        'bezahlen',
        'jetzt bezahlen',
        'zahlungspflichtig bestellen',
        'kostenpflichtig bestellen',
        'kaufen',
        'jetzt kaufen',
        'buy',
        'buy now',
        'purchase',
        'checkout',
        'zur kasse',
        'kasse',
        'order now',
        'bestellung abschliessen',
        'comprar',
        'pagar',
        'finalizar compra',
        'subscribe',
        'abonnieren',
        'add payment',
        'zahlungsmittel',
    ],
    delete: [
        'delete',
        'loschen',
        'entfernen',
        'remove',
        'borrar',
        'eliminar',
        'stornieren',
        'storno',
        'kundigen',
        'cancel booking',
        'cancel order',
        'cancel subscription',
        'buchung stornieren',
        'trash',
        'papierkorb',
        'deaktivieren',
        'deactivate',
    ],
    external_message: [
        'send message',
        'nachricht senden',
        'reply',
        'antworten',
        'responder',
        'post comment',
        'kommentar posten',
        'tweet',
        'share',
        'teilen',
        'compartir',
        'invite',
        'einladen',
    ],
    // Declared LAST on purpose: it is the catch-all for "this submits something", and the
    // first matching category is the one the approval dialog names. A button reading
    // "Nachricht senden" matches both this and external_message, and the specific label is
    // the one the user needs to read.
    submit_publish: [
        'submit',
        'absenden',
        'abschicken',
        'senden',
        'send',
        'publish',
        'veroffentlichen',
        'save',
        'speichern',
        'apply',
        'bewerben',
        'confirm',
        'bestatigen',
        'enviar',
        'publicar',
        'guardar',
        'confirmar',
    ],
}

const CATEGORY_MATCHERS = Object.entries(CATEGORY_TERMS).map(([category, terms]) => ({
    category,
    matcher: buildMatcher(terms),
}))

// Path fragments that betray the same intent when the label does not (an icon-only button, an
// image submit). Matched against the form action and the page path.
const CATEGORY_PATH_TERMS = {
    login: ['login', 'signin', 'sign-in', 'anmelden', 'auth', 'oauth', 'session'],
    payment: ['checkout', 'payment', 'zahlung', 'kasse', 'bestellen', 'order', 'pago', 'billing'],
    booking: ['booking', 'buchung', 'reservation', 'reservierung', 'reserva', 'termin'],
    delete: ['delete', 'loeschen', 'remove', 'storno', 'cancel', 'eliminar'],
    file_upload: ['upload', 'hochladen', 'subir'],
}

const CATEGORY_PATH_MATCHERS = Object.entries(CATEGORY_PATH_TERMS).map(([category, terms]) => ({
    category,
    matcher: new RegExp(terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i'),
}))

// A GET navigation is normally a read — except when the path IS the action. These are the shapes
// where following a link changes something, so a navigation to one of them pauses like a click on
// the same thing would.
const SIDE_EFFECT_PATH_MATCHER =
    /(?:^|[/_-])(?:logout|signout|sign-out|abmelden|delete|loeschen|remove|storno|stornieren|cancel-order|cancel-booking|kuendigen|unsubscribe|confirm-order|pay|payment-confirm|checkout-complete)(?:$|[/_?-])/i

const SEARCH_FIELD_MATCHER =
    /(?:^|[^a-z0-9])(?:q|s|query|search|suche|suchen|suchbegriff|busca|buscar|keyword|term)(?:[^a-z0-9]|$)/i

function collectTargetText(target = {}) {
    return [
        target.name,
        target.accessibleName,
        target.ariaLabel,
        target.text,
        target.title,
        target.placeholder,
        target.alt,
        target.buttonValue,
        ...(Array.isArray(target.submitLabels) ? target.submitLabels : []),
        target.formName,
        target.formAriaLabel,
    ]
        .filter(value => typeof value === 'string' && value.trim())
        .join(' · ')
}

/**
 * Classify what the observed element would do. Returns every category that matched, most specific
 * first — the caller uses the first one for the approval question but records all of them, so an
 * "it was only a submit" argument after the fact can be checked against what was actually seen.
 */
function classifyObservedTarget(target = {}, pageUrl = '') {
    const categories = []
    const evidence = []

    const inputType = normalizeText(target.inputType)
    if (inputType === 'password') {
        categories.push('login')
        evidence.push('input type=password')
    }
    if (inputType === 'file' || target.acceptsFiles === true) {
        categories.push('file_upload')
        evidence.push('file input')
    }

    const haystack = normalizeText(collectTargetText(target))
    for (const { category, matcher } of CATEGORY_MATCHERS) {
        if (haystack && matcher.test(haystack) && !categories.includes(category)) {
            categories.push(category)
            evidence.push(`label matched ${category}`)
        }
    }

    const paths = [target.formAction, target.href, pageUrl]
        .filter(value => typeof value === 'string' && value)
        .map(value => {
            try {
                return new URL(value, 'https://placeholder.invalid').pathname
            } catch (error) {
                return value
            }
        })
        .join(' ')
    for (const { category, matcher } of CATEGORY_PATH_MATCHERS) {
        if (paths && matcher.test(paths) && !categories.includes(category)) {
            categories.push(category)
            evidence.push(`url path matched ${category}`)
        }
    }

    return { categories, evidence }
}

/**
 * Does this submit only read? A GET form whose fields are search-shaped changes nothing on the
 * server, and it is the ordinary way to ask a ticket site about a date. Never consulted when a
 * sensitive category already matched.
 */
function looksLikeSearchSubmit(target = {}) {
    const method = normalizeText(target.formMethod || 'get')
    if (method && method !== 'get') return false
    if (normalizeText(target.formRole) === 'search') return true
    if (normalizeText(target.inputType) === 'search') return true
    const fieldNames = [target.fieldName, target.name, target.placeholder, target.formName, target.ariaLabel]
        .concat(Array.isArray(target.formFieldNames) ? target.formFieldNames : [])
        .filter(value => typeof value === 'string' && value)
        .join(' ')
    return SEARCH_FIELD_MATCHER.test(normalizeText(fieldNames))
}

function buildApprovalSignature({ action, category, hostname, target = {} }) {
    const shape = [
        normalizeText(action),
        normalizeText(category),
        normalizeText(hostname),
        normalizeText(target.role || target.tagName || ''),
        normalizeText(target.inputType || ''),
        normalizeText(collectTargetText(target)).slice(0, 120),
    ].join('|')
    return crypto.createHash('sha256').update(shape).digest('hex').slice(0, 32)
}

// Which categories may be approved ONCE FOR THE WHOLE RUN, and which must be answered every single
// time. The distinction is not how dangerous the category sounds — every one of these pauses — but
// whether repeating the operation is the same decision or a new one.
//
// A form submission or a booking flow is typically several presses of the same shaped control
// (`Weiter`, `Weiter`, `Bestätigen`); making the user answer each identical press is what trains
// them to stop reading the dialog. A payment, a deletion, a login and a file upload are the
// opposite: each one is its own irreversible act, and "yes, and stop asking" is precisely the
// answer that must not be available. `external_message` joins them because every send reaches a
// different person.
//
// The UI hides the button for these, and `respondToBrowserApproval` REFUSES a run-scoped answer for
// them — a hidden button is a hint, not a control.
const RUN_SCOPED_APPROVAL_CATEGORIES = new Set(['submit_publish', 'booking'])

function allowsRunScopedApproval(category) {
    return RUN_SCOPED_APPROVAL_CATEGORIES.has(String(category || ''))
}

function describeCategory(category) {
    switch (category) {
        case 'login':
            return 'signing in or entering credentials'
        case 'file_upload':
            return 'uploading a file'
        case 'booking':
            return 'making a booking or reservation'
        case 'payment':
            return 'paying or placing an order'
        case 'submit_publish':
            return 'submitting or publishing a form'
        case 'delete':
            return 'deleting or cancelling something'
        case 'external_message':
            return 'sending a message from your account'
        default:
            return 'a state-changing action'
    }
}

function deny(reason, message, extra = {}) {
    return { decision: 'deny', reason, message, categories: [], evidence: [], ...extra }
}

function allow(extra = {}) {
    return { decision: 'allow', reason: null, message: '', categories: [], evidence: [], ...extra }
}

/**
 * The one gate.
 *
 * `target` must be the descriptor the worker resolved from the live page, and is required for click
 * and type — a missing descriptor is a denial rather than a pass, so a worker that cannot resolve
 * the element (it moved, the page navigated) can never turn into an unclassified action.
 */
function evaluateBrowserAction({
    action,
    args = {},
    allowlist = [],
    target = null,
    pageUrl = '',
    allowSearchSubmit = true,
} = {}) {
    switch (action) {
        case 'navigate': {
            const check = checkUrlAgainstAllowlist(args.url, allowlist)
            if (!check.allowed) return deny(check.reason, check.message)
            let pathname = ''
            try {
                pathname = new URL(check.url).pathname
            } catch (error) {
                pathname = ''
            }
            if (SIDE_EFFECT_PATH_MATCHER.test(pathname)) {
                const category = /delete|loeschen|remove|storno|kuendigen|cancel/i.test(pathname)
                    ? 'delete'
                    : /pay|checkout/i.test(pathname)
                      ? 'payment'
                      : 'submit_publish'
                return {
                    decision: 'requires_approval',
                    reason: 'side_effect_url',
                    category,
                    categories: [category],
                    evidence: ['the URL path performs an action rather than showing a page'],
                    message: `Opening ${check.hostname}${pathname} would perform ${describeCategory(category)}.`,
                    hostname: check.hostname,
                    url: check.url,
                    allowRunScope: allowsRunScopedApproval(category),
                    signature: buildApprovalSignature({
                        action,
                        category,
                        hostname: check.hostname,
                        target: { name: pathname },
                    }),
                }
            }
            return allow({ url: check.url, hostname: check.hostname })
        }

        case 'inspect':
        case 'wait':
        case 'screenshot': {
            // Read-only against the page that is already open; the page itself was allowlisted when
            // it was opened and every navigation the worker performs is re-checked there.
            return allow()
        }

        case 'click':
        case 'type': {
            const pageCheck = checkUrlAgainstAllowlist(pageUrl, allowlist)
            if (!pageCheck.allowed) return deny(pageCheck.reason, pageCheck.message)
            if (!target || typeof target !== 'object') {
                return deny(
                    DENY_REASONS.NO_SESSION,
                    'The element could not be resolved on the current page, so the action cannot be classified. Take a fresh browser_inspect snapshot and try again.'
                )
            }

            const typedText = action === 'type' ? String(args.text || '') : ''
            const { categories, evidence } = classifyObservedTarget(target, pageCheck.url)

            // A credential may only ever be typed into something that is observably a credential
            // field, and even then only with an approval. Anywhere else it is refused outright:
            // pasting a key into a search box publishes it to a third party.
            if (typedText && containsLikelySecret(typedText) && !categories.includes('login')) {
                return deny(
                    DENY_REASONS.SECRET_IN_INPUT,
                    'The text looks like a credential or key and the field is not a credential field. Alldone does not type secrets into web pages.',
                    { categories, evidence }
                )
            }

            const isSubmitting = action === 'click' ? target.isSubmit === true : args.submit === true
            const sensitive = categories.find(category => isSensitiveCategory(category))

            if (!sensitive && isSubmitting) {
                if (allowSearchSubmit && looksLikeSearchSubmit(target)) {
                    return allow({
                        categories: ['search_submit'],
                        evidence: ['GET form with a search-shaped field'],
                        hostname: pageCheck.hostname,
                    })
                }
                const category = 'submit_publish'
                return {
                    decision: 'requires_approval',
                    reason: 'form_submission',
                    category,
                    categories: [category],
                    evidence: [...evidence, 'the control submits a form'],
                    message: `This would submit a form on ${pageCheck.hostname}.`,
                    hostname: pageCheck.hostname,
                    allowRunScope: allowsRunScopedApproval(category),
                    signature: buildApprovalSignature({ action, category, hostname: pageCheck.hostname, target }),
                }
            }

            if (sensitive) {
                return {
                    decision: 'requires_approval',
                    reason: 'sensitive_action',
                    category: sensitive,
                    categories,
                    evidence,
                    message: `This would perform ${describeCategory(sensitive)} on ${pageCheck.hostname}.`,
                    hostname: pageCheck.hostname,
                    allowRunScope: allowsRunScopedApproval(sensitive),
                    signature: buildApprovalSignature({
                        action,
                        category: sensitive,
                        hostname: pageCheck.hostname,
                        target,
                    }),
                }
            }

            return allow({ categories, evidence, hostname: pageCheck.hostname })
        }

        default:
            return deny(DENY_REASONS.UNKNOWN_ACTION, `Unknown browser action: ${action}`)
    }
}

module.exports = {
    CATEGORY_TERMS,
    RUN_SCOPED_APPROVAL_CATEGORIES,
    allowsRunScopedApproval,
    buildApprovalSignature,
    classifyObservedTarget,
    describeCategory,
    evaluateBrowserAction,
    looksLikeSearchSubmit,
    normalizeText,
}
