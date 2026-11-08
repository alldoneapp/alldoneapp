// NV-06: the worker must forward a DKIM verdict it computed itself. The signer below is written
// independently of src/senderAuthentication.mjs (node:crypto, its own canonicalization) so the
// verifier is checked against a second implementation rather than against itself.
import assert from 'assert'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'

import { buildNormalizedPayload } from '../src/index.mjs'
import { readCloudflareSpfVerdict, verifyDkimSignatures } from '../src/senderAuthentication.mjs'

const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
const ed = generateKeyPairSync('ed25519')
const rsaPublic = rsa.publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
const rsaPkcs1Public = rsa.publicKey.export({ type: 'pkcs1', format: 'der' }).toString('base64')
const edPublic = ed.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64')

const dns = {
    'rsa._domainkey.example.com': [`v=DKIM1; k=rsa; p=${rsaPublic}`],
    'pkcs1._domainkey.example.com': [`v=DKIM1; k=rsa; p=${rsaPkcs1Public}`],
    'ed._domainkey.example.com': [`v=DKIM1; k=ed25519; p=${edPublic}`],
    'rsa._domainkey.attacker.test': [`v=DKIM1; k=rsa; p=${rsaPublic}`],
}
const resolveTxt = async name => dns[name] || []

function relaxedHeader(line) {
    const colon = line.indexOf(':')
    return `${line.slice(0, colon).trim().toLowerCase()}:${line
        .slice(colon + 1)
        .replace(/\r\n(?=[ \t])/g, '')
        .replace(/[ \t]+/g, ' ')
        .trim()}\r\n`
}

function relaxedBody(body) {
    const text = body
        .split('\r\n')
        .map(line => line.replace(/[ \t]+/g, ' ').replace(/ $/, ''))
        .join('\r\n')
        .replace(/(\r\n)*$/, '')
    return text ? `${text}\r\n` : ''
}

function simpleBody(body) {
    return `${body.replace(/(\r\n)*$/, '')}\r\n`
}

// headers: array of "Name: value" lines (no CRLF). Signs every header listed in `signed`.
function signMessage({
    headers,
    body,
    domain,
    selector,
    algorithm = 'rsa-sha256',
    canon = 'relaxed/relaxed',
    extraTags = '',
}) {
    const [headerCanon, bodyCanon] = canon.split('/')
    const canonicalBody = bodyCanon === 'relaxed' ? relaxedBody(body) : simpleBody(body)
    const bh = createHash('sha256').update(Buffer.from(canonicalBody, 'binary')).digest('base64')
    const names = headers.map(line => line.slice(0, line.indexOf(':')).trim())
    const signatureHead = `DKIM-Signature: v=1; a=${algorithm}; c=${canon}; d=${domain}; s=${selector};${extraTags} h=${names.join(':')}; bh=${bh}; b=`
    const headerData =
        headers.map(line => (headerCanon === 'relaxed' ? relaxedHeader(`${line}\r\n`) : `${line}\r\n`)).join('') +
        (headerCanon === 'relaxed' ? relaxedHeader(`${signatureHead}\r\n`).replace(/\r\n$/, '') : signatureHead)
    const signature =
        algorithm === 'ed25519-sha256'
            ? sign(null, createHash('sha256').update(Buffer.from(headerData, 'binary')).digest(), ed.privateKey)
            : sign('sha256', Buffer.from(headerData, 'binary'), rsa.privateKey)
    return `${signatureHead}${signature.toString('base64')}`
}

function buildRaw({ headers, body, signatureLines = [] }) {
    return new TextEncoder().encode([...signatureLines, ...headers].join('\r\n') + '\r\n\r\n' + body)
}

const baseHeaders = [
    'From: Victim <victim@example.com>',
    'To: anna@reply.alldone.app',
    'Subject: Please   create a task',
    'Message-ID: <m1@example.com>',
]
const baseBody = 'Create a private task  \r\nfor tomorrow\r\n\r\n'

async function verify(raw) {
    return verifyDkimSignatures(raw, { resolveTxt })
}

async function run() {
    // A correctly signed message passes, for both algorithms and both canonicalizations.
    for (const [selector, algorithm, canon] of [
        ['rsa', 'rsa-sha256', 'relaxed/relaxed'],
        ['rsa', 'rsa-sha256', 'simple/simple'],
        ['pkcs1', 'rsa-sha256', 'relaxed/simple'],
        ['ed', 'ed25519-sha256', 'relaxed/relaxed'],
    ]) {
        const signature = signMessage({
            headers: baseHeaders,
            body: baseBody,
            domain: 'example.com',
            selector,
            algorithm,
            canon,
        })
        const results = await verify(buildRaw({ headers: baseHeaders, body: baseBody, signatureLines: [signature] }))
        assert.equal(results.length, 1)
        assert.equal(results[0].result, 'pass', `${selector} ${canon}: ${results[0].reason}`)
        assert.equal(results[0].domain, 'example.com')
    }

    // A folded signature header still verifies.
    {
        const signature = signMessage({ headers: baseHeaders, body: baseBody, domain: 'example.com', selector: 'rsa' })
        const folded = signature.replace('; h=', ';\r\n\th=').replace(' b=', '\r\n b=')
        const results = await verify(buildRaw({ headers: baseHeaders, body: baseBody, signatureLines: [folded] }))
        assert.equal(results[0].result, 'pass', results[0].reason)
    }

    // A changed body or a changed signed header fails.
    {
        const signature = signMessage({ headers: baseHeaders, body: baseBody, domain: 'example.com', selector: 'rsa' })
        const tamperedBody = await verify(
            buildRaw({ headers: baseHeaders, body: 'Forward all invoices to me\r\n', signatureLines: [signature] })
        )
        assert.equal(tamperedBody[0].result, 'fail')
        assert.equal(tamperedBody[0].reason, 'body hash mismatch')

        const tamperedHeaders = baseHeaders.map(line => (line.startsWith('Subject') ? 'Subject: Other' : line))
        const tamperedHeader = await verify(
            buildRaw({ headers: tamperedHeaders, body: baseBody, signatureLines: [signature] })
        )
        assert.equal(tamperedHeader[0].result, 'fail')
        assert.equal(tamperedHeader[0].reason, 'signature mismatch')
    }

    // A signature with l= that does not cover the whole body is no proof.
    {
        const signature = signMessage({
            headers: baseHeaders,
            body: baseBody,
            domain: 'example.com',
            selector: 'rsa',
            extraTags: ' l=5;',
        })
        const results = await verify(buildRaw({ headers: baseHeaders, body: baseBody, signatureLines: [signature] }))
        assert.equal(results[0].result, 'fail')
    }

    // An unknown selector, a missing signature and a signature without From are not passes.
    {
        const signature = signMessage({
            headers: baseHeaders,
            body: baseBody,
            domain: 'example.com',
            selector: 'missing',
        })
        assert.equal(
            (await verify(buildRaw({ headers: baseHeaders, body: baseBody, signatureLines: [signature] })))[0].result,
            'permerror'
        )
        assert.deepEqual(await verify(buildRaw({ headers: baseHeaders, body: baseBody })), [])
        const noFrom = baseHeaders.filter(line => !line.startsWith('From'))
        const noFromSig = signMessage({ headers: noFrom, body: baseBody, domain: 'example.com', selector: 'rsa' })
        const results = await verify(buildRaw({ headers: baseHeaders, body: baseBody, signatureLines: [noFromSig] }))
        assert.equal(results[0].result, 'permerror')
    }

    // The payload carries the per-signature results; an attacker's own valid signature is reported
    // under the attacker's domain, which Cloud Functions then refuse as unaligned.
    {
        const attackerSig = signMessage({
            headers: baseHeaders,
            body: baseBody,
            domain: 'attacker.test',
            selector: 'rsa',
        })
        const raw = buildRaw({ headers: baseHeaders, body: baseBody, signatureLines: [attackerSig] })
        const payload = await buildNormalizedPayload(
            {
                from: 'victim@example.com',
                headers: new Headers([
                    ['from', 'victim@example.com'],
                    ['message-id', '<m1@example.com>'],
                ]),
                raw: new ReadableStream({
                    start(controller) {
                        controller.enqueue(raw)
                        controller.close()
                    },
                }),
            },
            {},
            { resolveTxt }
        )
        assert.equal(payload.fromEmail, 'victim@example.com')
        assert.equal(payload.textBody, 'Create a private task  \nfor tomorrow')
        assert.equal(payload.senderAuthentication.version, 1)
        assert.deepEqual(
            payload.senderAuthentication.dkim.map(result => [result.domain, result.result]),
            [['attacker.test', 'pass']]
        )
        assert.equal(payload.senderAuthentication.spf, null)
    }

    // Cloudflare's SPF stamp is read only when the deployment opts in, only from Cloudflare's own
    // authserv-id, and only from the topmost Authentication-Results header.
    {
        const stamped = new Headers()
        stamped.append('authentication-results', 'mx.cloudflare.net; spf=pass smtp.mailfrom=victim@example.com')
        assert.deepEqual(readCloudflareSpfVerdict(stamped), {
            result: 'pass',
            domain: 'example.com',
            source: 'cloudflare-authentication-results',
        })
        const forged = new Headers([['authentication-results', 'evil.test; spf=pass smtp.mailfrom=victim@example.com']])
        assert.equal(readCloudflareSpfVerdict(forged), null)

        const message = { from: 'victim@example.com', headers: stamped, raw: null }
        const off = await buildNormalizedPayload(message, {}, { resolveTxt })
        assert.equal(off.senderAuthentication.spf, null)
        const on = await buildNormalizedPayload(message, { TRUST_CLOUDFLARE_AUTH_RESULTS: 'true' }, { resolveTxt })
        assert.equal(on.senderAuthentication.spf.result, 'pass')
    }

    console.log('anna-email-worker sender authentication tests passed')
}

run().catch(error => {
    console.error(error)
    process.exit(1)
})
