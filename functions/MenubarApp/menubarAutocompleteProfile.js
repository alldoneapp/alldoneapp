'use strict'

// Writer profile for the Mac app's on-device autocomplete (Anna menubar, llama.cpp).
//
// The Mac app puts this text on a "Writer:" line in front of whatever the user is typing, so a
// small local model can complete names, roles and places correctly. Measurements on those models
// showed they pick up concrete facts and ignore style rules, so this is a list of facts, not tone
// instructions.
//
// Pure data assembly: no model is called, so no Gold or credits are charged. The text goes only
// to the user's own Mac, and typed text never reaches the server. Even so, anything that looks
// like a contact detail, link, credential or money matter is dropped whole (not redacted), so a
// half-sentence never leaks into another app's text field as a suggestion.

const { isProjectMemberData } = require('../shared/privacyAccess')
const { readUserMemory } = require('../Assistant/userMemoryHelper')

// The Mac app cuts at 600 characters on a word boundary; staying under it keeps the cut ours.
const AUTOCOMPLETE_PROFILE_MAX_CHARS = 600
// A longer single item would crowd out every other fact.
const PROFILE_ITEM_MAX_CHARS = 200
// The description gets the first share of the budget; memory facts fill the rest.
const PROFILE_DESCRIPTION_BUDGET_CHARS = 300

const SENSITIVE_PATTERNS = [
    // Email addresses
    /[^\s@]+@[^\s@]+\.[^\s@]+/,
    // Links
    /\bhttps?:\/\//i,
    /\bwww\.\S+/i,
    // Credentials and token-shaped strings
    /\b(?:adapp_|sk-|sk_|pk_|rk_|ghp_|gho_|glpat-|xox[abp]-|AKIA|AIza)\S*/,
    /[A-Za-z0-9_\-+/=]{32,}/,
    // IBAN
    /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,}/,
    // Money amounts
    /[€$£]\s?\d/,
    /\d\s?(?:€|\$|£|(?:eur|euro|euros|usd|chf|gbp|dollar|dollars)\b)/i,
    // Street addresses (a city is a useful place, a home address is not)
    /\b\p{L}+(?:straße|strasse|str\.|gasse|allee|weg|platz|street|st\.|road|avenue|calle)\s*\d+/iu,
    // Credential, finance and identity words (en, de, es)
    /\b(?:password|passwort|kennwort|contraseña|pin|tan|token|api[\s_-]?key|secret|geheim|iban|bic|swift|credit\s?card|kreditkarte|tarjeta|bank|konto|kontonummer|account\s?number|cuenta|salary|gehalt|salario|einkommen|income|steuer\w*|tax|impuesto\w*|ssn|social\s?security|sozialversicherung\w*|passport|reisepass|pasaporte|personalausweis|dni|invoice|rechnung\w*|factura\w*|schulden|debt|deuda|kredit|loan|darlehen|préstamo)\b/iu,
]

// Phone numbers and other long numbers (account, card, ID numbers). Dates such as 2026-11-10 have
// eight digits and pass; anything starting like a dialled number or with nine or more digits does
// not.
const NUMBER_RUN_PATTERN = /\+?\d[\d\s()./-]{5,}\d/g

function countDigits(text) {
    return (text.match(/\d/g) || []).length
}

function hasSensitiveNumber(text) {
    for (const match of text.match(NUMBER_RUN_PATTERN) || []) {
        const digits = countDigits(match)
        if (digits >= 9) return true
        if (digits >= 7 && /^(?:\+|0)/.test(match.trim())) return true
    }
    return false
}

function isSensitive(text) {
    return hasSensitiveNumber(text) || SENSITIVE_PATTERNS.some(pattern => pattern.test(text))
}

// Turns markdown into plain words: a link keeps its label next to its URL (so the URL check still
// drops the sentence), emphasis marks go, and heading lines ("About me") go entirely: they carry
// no fact and only spend the budget.
function stripMarkdown(text) {
    return String(text || '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]+)\]\(([^)]*)\)/g, (_, label, url) => `${label} ${url}`)
        .replace(/`+/g, '')
        .replace(/^\s{0,3}#{1,6}\s+.*$/gm, '')
        .replace(/^\s{0,3}>\s?/gm, '')
        .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, '')
        .replace(/(\*\*|__|\*|_|~~)(\S(?:.*?\S)?)\1/g, '$2')
}

function collapseWhitespace(text) {
    return String(text || '')
        .replace(/\s+/g, ' ')
        .trim()
}

function truncateOnWordBoundary(text, maxChars) {
    if (text.length <= maxChars) return text
    const cut = text.slice(0, maxChars + 1)
    const lastSpace = cut.lastIndexOf(' ')
    return (lastSpace > 0 ? cut.slice(0, lastSpace) : text.slice(0, maxChars)).replace(/[\s,;:–-]+$/, '')
}

// One clean sentence, or '' when the item is empty or sensitive.
function toProfileItem(raw) {
    const text = collapseWhitespace(raw)
    if (text.length < 3 || isSensitive(text)) return ''
    const item = truncateOnWordBoundary(text, PROFILE_ITEM_MAX_CHARS)
    return /[.!?]$/.test(item) ? item : `${item}.`
}

// A description is free text, often a few lines or bullets: split it into sentences so a single
// sensitive sentence costs only itself.
function splitDescription(description) {
    return stripMarkdown(description)
        .split(/\n+/)
        .flatMap(line => line.split(/(?<=[.!?])\s+(?=[\p{Lu}\d"„«(])/u))
        .map(toProfileItem)
        .filter(Boolean)
}

// Memory lines look like "2026-11-10: [category] fact (reason)". Only the fact is useful; the
// newest lines come last in storage and matter most, so they come first here.
function splitMemory(content) {
    return String(content || '')
        .split('\n')
        .map(line =>
            line
                .replace(/^\s*\d{4}-\d{2}-\d{2}:\s*/, '')
                .replace(/^\[[^\]]*\]\s*/, '')
                .replace(/\s*\([^()]*\)\s*$/, '')
        )
        .map(line => toProfileItem(stripMarkdown(line)))
        .filter(Boolean)
        .reverse()
}

function cleanField(value) {
    const text = collapseWhitespace(stripMarkdown(typeof value === 'string' ? value : ''))
    if (!text || isSensitive(text)) return ''
    return truncateOnWordBoundary(text, 80)
}

function pickDescription(record = {}) {
    if (typeof record.extendedDescription === 'string' && record.extendedDescription.trim()) {
        return record.extendedDescription
    }
    return typeof record.description === 'string' ? record.description : ''
}

function buildHeadline({ name, role, company }) {
    const roleAtCompany = role && company ? `${role} at ${company}` : role || company
    return roleAtCompany ? `${name}, ${roleAtCompany}.` : `${name}.`
}

function normalizeForDedupe(text) {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
}

/**
 * Builds the profile text from already loaded data. Pure, so it is tested without Firestore.
 * Returns '' without a name, just the name when nothing else is known.
 */
function buildAutocompleteProfile({
    userData = {},
    projectUserData = {},
    memoryContent = '',
    maxChars = AUTOCOMPLETE_PROFILE_MAX_CHARS,
} = {}) {
    const name = cleanField(userData.displayName || userData.name)
    if (!name) return ''

    const role = cleanField(projectUserData.role) || cleanField(userData.role)
    const company = cleanField(projectUserData.company) || cleanField(userData.company)
    const headline = buildHeadline({ name, role, company })

    // No "Writes in <language>" line: the app language says little about what someone types,
    // and many users switch languages all the time. The model reads the language from the text.

    const descriptionItems = [
        ...splitDescription(pickDescription(userData)),
        ...splitDescription(pickDescription(projectUserData)),
    ]
    const memoryItems = splitMemory(memoryContent)

    const parts = []
    const seen = new Set()
    let length = 0
    const tryAdd = (item, limit) => {
        const key = normalizeForDedupe(item)
        if (!key || seen.has(key)) return false
        const added = (parts.length ? 1 : 0) + item.length
        if (length + added > limit) return false
        parts.push(item)
        seen.add(key)
        length += added
        return true
    }

    if (!tryAdd(headline, maxChars)) return truncateOnWordBoundary(name, maxChars)

    const descriptionLimit = Math.min(maxChars, length + PROFILE_DESCRIPTION_BUDGET_CHARS)
    const leftoverDescription = descriptionItems.filter(item => !tryAdd(item, descriptionLimit))
    memoryItems.forEach(item => tryAdd(item, maxChars))
    leftoverDescription.forEach(item => tryAdd(item, maxChars))

    // Nothing known beyond the name: just the name, as the Mac app's own fallback would send.
    if (parts.length === 1 && parts[0] === `${name}.`) return name
    return parts.join(' ')
}

/**
 * Loads the profile sources the assistant's own context uses (global user description, the
 * default project's user data and the private user memory for that project) and builds the text.
 * The default project counts only while the user is still a member of it.
 */
async function getAutocompleteProfile(db, userId, userData = {}) {
    let projectUserData = {}
    let memoryContent = ''

    const defaultProjectId = typeof userData.defaultProjectId === 'string' ? userData.defaultProjectId : ''
    if (defaultProjectId) {
        try {
            const projectDoc = await db.doc(`projects/${defaultProjectId}`).get()
            const project = projectDoc.exists ? projectDoc.data() || {} : null
            if (project && isProjectMemberData(project, userId)) {
                projectUserData = project.usersData?.[userId] || {}
                const memory = await readUserMemory({ db, projectId: defaultProjectId, userId })
                memoryContent = memory.content
            }
        } catch (error) {
            // The headline and global description still make a useful profile without them.
            console.warn('menubarAutocompleteProfile: project context failed', { userId, error: error.message })
        }
    }

    return buildAutocompleteProfile({ userData, projectUserData, memoryContent })
}

module.exports = {
    AUTOCOMPLETE_PROFILE_MAX_CHARS,
    buildAutocompleteProfile,
    getAutocompleteProfile,
    __private__: { isSensitive, splitDescription, splitMemory, truncateOnWordBoundary },
}
