// security audit 2026-11 (NV-06): proof that a message really comes from its SMTP envelope sender.
//
// The Anna email channel maps the envelope sender (`message.from`) to an Alldone account, and the
// envelope sender is whatever the sending server claims. Cloudflare Email Routing does not hand an
// Email Worker a dependable SPF/DKIM/DMARC verdict: `Authentication-Results` is reported missing
// in Worker headers (workerd#6740), and any such header could also have been written by the sender
// itself. So the worker verifies DKIM signatures on the raw message itself (RFC 6376, rsa-sha256
// and ed25519-sha256, keys fetched over DNS-over-HTTPS) and forwards the per-signature results.
// Cloud Functions decide alignment with the envelope sender (functions/Email/emailSenderAuthentication.js).
//
// SPF cannot be checked here: an Email Worker is not told the connecting IP. A Cloudflare-stamped
// `Authentication-Results: mx.cloudflare.net; spf=...` header is forwarded only when the deployment
// sets TRUST_CLOUDFLARE_AUTH_RESULTS=true, after somebody has confirmed on a live message that
// Cloudflare adds that header AND strips a forged copy sent in by the sender.

export const SENDER_AUTHENTICATION_VERSION = 1
const MAX_SIGNATURES = 5
const MIN_RSA_KEY_BITS = 1024
const DOH_ENDPOINT = 'https://cloudflare-dns.com/dns-query'

// ---- byte <-> binary string (one char per byte, so hashing sees the exact bytes) ----

export function bytesToBinary(bytes) {
    let out = ''
    const chunk = 0x8000
    for (let index = 0; index < bytes.length; index += chunk) {
        out += String.fromCharCode.apply(null, bytes.subarray(index, index + chunk))
    }
    return out
}

function binaryToBytes(text) {
    const bytes = new Uint8Array(text.length)
    for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff
    return bytes
}

function base64ToBytes(value) {
    const clean = String(value || '').replace(/[\s]/g, '')
    const binary = atob(clean)
    return binaryToBytes(binary)
}

function bytesToBase64(bytes) {
    return btoa(bytesToBinary(bytes))
}

async function sha256(binaryText) {
    return new Uint8Array(await crypto.subtle.digest('SHA-256', binaryToBytes(binaryText)))
}

// ---- message parsing ----

// Mail on the wire is CRLF; a bare LF is normalised so both canonicalizations see proper lines.
function normalizeLineEndings(text) {
    return text.replace(/\r?\n/g, '\r\n')
}

export function splitMessage(binaryMessage) {
    const text = normalizeLineEndings(binaryMessage)
    const separator = text.indexOf('\r\n\r\n')
    if (separator === -1) return { headerBlock: text.endsWith('\r\n') ? text : `${text}\r\n`, body: '' }
    return { headerBlock: text.slice(0, separator + 2), body: text.slice(separator + 4) }
}

// Every header field with its exact raw text (folding included, ending in CRLF), in order.
export function parseHeaderFields(headerBlock) {
    const fields = []
    const lines = headerBlock.split('\r\n')
    for (const line of lines) {
        if (line === '') continue
        if ((line[0] === ' ' || line[0] === '\t') && fields.length) {
            fields[fields.length - 1].raw += `${line}\r\n`
            continue
        }
        const colon = line.indexOf(':')
        if (colon <= 0) continue
        fields.push({ name: line.slice(0, colon).trim().toLowerCase(), raw: `${line}\r\n` })
    }
    return fields
}

function fieldValue(field) {
    return field.raw
        .slice(field.raw.indexOf(':') + 1)
        .replace(/\r\n(?=[ \t])/g, '')
        .replace(/\r\n$/, '')
}

export function parseTagList(value) {
    const tags = {}
    for (const part of String(value || '').split(';')) {
        const equals = part.indexOf('=')
        if (equals === -1) continue
        const name = part.slice(0, equals).replace(/\s+/g, '').toLowerCase()
        if (!name || Object.prototype.hasOwnProperty.call(tags, name)) continue
        tags[name] = part.slice(equals + 1).trim()
    }
    return tags
}

// ---- canonicalization (RFC 6376 section 3.4) ----

export function canonicalizeBody(body, mode) {
    let text = body
    if (mode === 'relaxed') {
        text = text
            .split('\r\n')
            .map(line => line.replace(/[ \t]+/g, ' ').replace(/ $/, ''))
            .join('\r\n')
        text = text.replace(/(\r\n)*$/, '')
        return text ? `${text}\r\n` : ''
    }
    text = text.replace(/(\r\n)*$/, '')
    return `${text}\r\n`
}

export function canonicalizeHeader(rawField, mode) {
    if (mode === 'relaxed') {
        const colon = rawField.indexOf(':')
        const name = rawField.slice(0, colon).trim().toLowerCase()
        const value = rawField
            .slice(colon + 1)
            .replace(/\r\n$/, '')
            .replace(/\r\n(?=[ \t])/g, '')
            .replace(/[ \t]+/g, ' ')
            .trim()
        return `${name}:${value}\r\n`
    }
    return rawField
}

// The signature's own header is hashed with an empty b= value and without its final CRLF.
function stripSignatureValue(rawField) {
    const colon = rawField.indexOf(':')
    const value = rawField
        .slice(colon + 1)
        .replace(/((?:^|;)[ \t\r\n]*b[ \t\r\n]*=)[^;]*/i, (match, prefix, offset, whole) => {
            // Keep the field's terminating CRLF when b= is the last tag.
            return whole.endsWith('\r\n') && offset + match.length === whole.length ? `${prefix}\r\n` : prefix
        })
    return rawField.slice(0, colon + 1) + value
}

function selectSignedHeaders(fields, signedNames) {
    const used = new Set()
    const selected = []
    for (const signedName of signedNames) {
        for (let index = fields.length - 1; index >= 0; index -= 1) {
            if (used.has(index) || fields[index].name !== signedName) continue
            used.add(index)
            selected.push(fields[index])
            break
        }
    }
    return selected
}

// ---- DNS ----

function unquoteTxtData(data) {
    const parts = String(data || '').match(/"((?:[^"\\]|\\.)*)"/g)
    if (!parts) return String(data || '')
    return parts.map(part => part.slice(1, -1).replace(/\\(.)/g, '$1')).join('')
}

export async function resolveTxtOverHttps(name, fetchImpl = fetch) {
    const url = `${DOH_ENDPOINT}?name=${encodeURIComponent(name)}&type=TXT`
    const response = await fetchImpl(url, { headers: { accept: 'application/dns-json' } })
    if (!response.ok) throw new Error(`DNS lookup failed with HTTP ${response.status}`)
    const json = await response.json()
    if (json.Status === 3) return []
    if (json.Status !== 0) throw new Error(`DNS lookup failed with status ${json.Status}`)
    return (Array.isArray(json.Answer) ? json.Answer : [])
        .filter(answer => answer.type === 16)
        .map(answer => unquoteTxtData(answer.data))
}

// ---- keys ----

function derLength(length) {
    if (length < 0x80) return [length]
    const bytes = []
    let remaining = length
    while (remaining > 0) {
        bytes.unshift(remaining & 0xff)
        remaining >>= 8
    }
    return [0x80 | bytes.length, ...bytes]
}

// Some domains publish a bare PKCS#1 RSAPublicKey instead of SubjectPublicKeyInfo.
function wrapRsaPublicKeyInSpki(pkcs1) {
    const algorithm = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]
    const bitString = [0x03, ...derLength(pkcs1.length + 1), 0x00, ...pkcs1]
    const body = [...algorithm, ...bitString]
    return new Uint8Array([0x30, ...derLength(body.length), ...body])
}

async function importRsaKey(keyBytes) {
    const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
    try {
        return await crypto.subtle.importKey('spki', keyBytes, algorithm, true, ['verify'])
    } catch (_) {
        return await crypto.subtle.importKey('spki', wrapRsaPublicKeyInSpki(keyBytes), algorithm, true, ['verify'])
    }
}

function rsaModulusBits(key) {
    const bits = key && key.algorithm && key.algorithm.modulusLength
    return Number(bits) || 0
}

// ---- verification ----

function signatureResult(tags, result, reason) {
    return {
        domain: String(tags.d || '')
            .trim()
            .toLowerCase(),
        selector: String(tags.s || '').trim(),
        algorithm: String(tags.a || '')
            .trim()
            .toLowerCase(),
        result,
        reason,
    }
}

async function verifyOneSignature({ field, fields, body, resolveTxt, now }) {
    const tags = parseTagList(fieldValue(field))
    const fail = (result, reason) => signatureResult(tags, result, reason)

    if (tags.v !== '1') return fail('permerror', 'unsupported version')
    const algorithm = String(tags.a || '').toLowerCase()
    if (algorithm !== 'rsa-sha256' && algorithm !== 'ed25519-sha256') {
        return fail('permerror', `unsupported algorithm ${algorithm || '(none)'}`)
    }
    const domain = String(tags.d || '')
        .trim()
        .toLowerCase()
    const selector = String(tags.s || '').trim()
    if (!domain || !selector || !tags.b || !tags.bh || !tags.h) return fail('permerror', 'missing required tag')
    const signedNames = tags.h
        .split(':')
        .map(name => name.trim().toLowerCase())
        .filter(Boolean)
    if (!signedNames.includes('from')) return fail('permerror', 'From header is not signed')
    if (tags.i) {
        const identityDomain = tags.i.slice(tags.i.lastIndexOf('@') + 1).toLowerCase()
        if (identityDomain !== domain && !identityDomain.endsWith(`.${domain}`)) {
            return fail('permerror', 'i= is outside d=')
        }
    }
    if (tags.x && Number(tags.x) * 1000 < now) return fail('fail', 'signature expired')

    const [headerMode, bodyMode = 'simple'] = String(tags.c || 'simple/simple')
        .toLowerCase()
        .split('/')
    if (!['simple', 'relaxed'].includes(headerMode) || !['simple', 'relaxed'].includes(bodyMode)) {
        return fail('permerror', 'unsupported canonicalization')
    }

    const canonicalBody = canonicalizeBody(body, bodyMode)
    // A length limit lets anybody append text below a genuinely signed body, so a signature that
    // does not cover the whole body is not accepted as proof.
    if (tags.l !== undefined && Number(tags.l) !== canonicalBody.length) {
        return fail('fail', 'body length limit does not cover the whole body')
    }
    const bodyHash = bytesToBase64(await sha256(canonicalBody))
    if (bodyHash !== tags.bh.replace(/\s+/g, '')) return fail('fail', 'body hash mismatch')

    const signedHeaders = selectSignedHeaders(
        fields.filter(candidate => candidate !== field),
        signedNames
    )
    const headerData =
        signedHeaders.map(signed => canonicalizeHeader(signed.raw, headerMode)).join('') +
        canonicalizeHeader(stripSignatureValue(field.raw), headerMode).replace(/\r\n$/, '')

    let records
    try {
        records = await resolveTxt(`${selector}._domainkey.${domain}`)
    } catch (error) {
        return fail('temperror', `key lookup failed: ${error.message}`)
    }
    const keyRecord = (records || []).map(parseTagList).find(record => record.p !== undefined)
    if (!keyRecord) return fail('permerror', 'no key record')
    if (keyRecord.v && keyRecord.v !== 'DKIM1') return fail('permerror', 'bad key record version')
    const keyType = String(keyRecord.k || 'rsa').toLowerCase()
    const publicKey = String(keyRecord.p || '').replace(/\s+/g, '')
    if (!publicKey) return fail('fail', 'key revoked')
    if (
        String(keyRecord.t || '')
            .split(':')
            .map(flag => flag.trim())
            .includes('s') &&
        tags.i
    ) {
        const identityDomain = tags.i.slice(tags.i.lastIndexOf('@') + 1).toLowerCase()
        if (identityDomain !== domain) return fail('fail', 'strict key requires i= domain to equal d=')
    }

    const signature = base64ToBytes(tags.b)
    try {
        if (algorithm === 'rsa-sha256') {
            if (keyType !== 'rsa') return fail('permerror', 'key type does not match algorithm')
            const key = await importRsaKey(base64ToBytes(publicKey))
            if (rsaModulusBits(key) && rsaModulusBits(key) < MIN_RSA_KEY_BITS) return fail('fail', 'RSA key too short')
            const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, binaryToBytes(headerData))
            return ok ? signatureResult(tags, 'pass', '') : fail('fail', 'signature mismatch')
        }
        if (keyType !== 'ed25519') return fail('permerror', 'key type does not match algorithm')
        const key = await crypto.subtle.importKey('raw', base64ToBytes(publicKey), { name: 'Ed25519' }, false, [
            'verify',
        ])
        // RFC 8463: Ed25519 signs the SHA-256 hash of the header data.
        const ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, await sha256(headerData))
        return ok ? signatureResult(tags, 'pass', '') : fail('fail', 'signature mismatch')
    } catch (error) {
        return fail('permerror', `verification error: ${error.message}`)
    }
}

export async function verifyDkimSignatures(rawBytes, { resolveTxt = resolveTxtOverHttps, now = Date.now() } = {}) {
    if (!rawBytes || !rawBytes.length) return []
    const { headerBlock, body } = splitMessage(bytesToBinary(rawBytes))
    const fields = parseHeaderFields(headerBlock)
    const signatures = fields.filter(field => field.name === 'dkim-signature').slice(0, MAX_SIGNATURES)
    const results = []
    for (const field of signatures) {
        try {
            results.push(await verifyOneSignature({ field, fields, body, resolveTxt, now }))
        } catch (error) {
            results.push({ domain: '', selector: '', algorithm: '', result: 'temperror', reason: error.message })
        }
    }
    return results
}

// Only consulted when the deployment opts in (see the header comment). The authserv-id must be
// Cloudflare's own, and only the first such header counts: an MTA prepends its result, so the top
// one is Cloudflare's and anything below it came in with the message.
export function readCloudflareSpfVerdict(headers) {
    const values = []
    if (headers && typeof headers.entries === 'function') {
        for (const [name, value] of headers.entries()) {
            if (String(name).toLowerCase() === 'authentication-results') values.push(String(value || ''))
        }
    }
    const first = values[0]
    if (!first) return null
    const [authservId, ...rest] = first.split(';')
    if (
        !/(^|\.)cloudflare\.net$/i.test(
            String(authservId || '')
                .trim()
                .split(/\s+/)[0]
        )
    )
        return null
    const match = rest.join(';').match(/\bspf\s*=\s*([a-z]+)[^;]*?\bsmtp\.mailfrom\s*=\s*"?([^\s;"]+)/i)
    if (!match) return null
    const mailFrom = match[2].toLowerCase()
    return {
        result: match[1].toLowerCase(),
        domain: mailFrom.slice(mailFrom.lastIndexOf('@') + 1),
        source: 'cloudflare-authentication-results',
    }
}

export async function buildSenderAuthentication({ rawBytes, headers, env = {}, resolveTxt, now } = {}) {
    let dkim = []
    try {
        dkim = await verifyDkimSignatures(rawBytes, { resolveTxt, now })
    } catch (error) {
        dkim = [{ domain: '', selector: '', algorithm: '', result: 'temperror', reason: error.message }]
    }
    const spf = String(env.TRUST_CLOUDFLARE_AUTH_RESULTS || '') === 'true' ? readCloudflareSpfVerdict(headers) : null
    return { version: SENDER_AUTHENTICATION_VERSION, dkim, spf }
}
