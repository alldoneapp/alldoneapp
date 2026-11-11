/**
 * ci/bumpAppVersion.js tells open clients about a deploy. A bare `curl` GET got 405 from the
 * locked-down function and still passed, so this script must authenticate and fail loudly.
 */
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const yaml = require('js-yaml')

const { bumpAppVersion, functionAudience, signAssertion } = require('../ci/bumpAppVersion')

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
const key = {
    client_email: 'deploy@alldonealeph.iam.gserviceaccount.com',
    private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    private_key_id: 'kid-1',
}
const writeKey = () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bump-')), 'key.json')
    fs.writeFileSync(file, JSON.stringify(key))
    return file
}
const URL_ = 'https://europe-west1-alldonealeph.cloudfunctions.net/increaseVersionSecondGen'

describe('bumpAppVersion', () => {
    it('signs an assertion for an identity token addressed to the function', () => {
        const jwt = signAssertion(key, URL_, 1000)
        const [header, claims, signature] = jwt.split('.')
        const payload = JSON.parse(Buffer.from(claims, 'base64').toString())
        expect(payload).toMatchObject({ iss: key.client_email, target_audience: URL_, iat: 1000, exp: 1600 })
        const valid = crypto
            .createVerify('RSA-SHA256')
            .update(`${header}.${claims}`)
            .verify(publicKey, Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64'))
        expect(valid).toBe(true)
        expect(functionAudience(`${URL_}?x=1`)).toBe(URL_)
    })

    it('POSTs with the identity token and returns the answer', async () => {
        const calls = []
        const fetchImpl = async (url, options) => {
            calls.push({ url, options })
            if (url.startsWith('https://oauth2.googleapis.com'))
                return { ok: true, status: 200, json: async () => ({ id_token: 'ID' }) }
            return { ok: true, status: 200, text: async () => 'Version increased to 1.2.0' }
        }
        await expect(bumpAppVersion({ url: URL_, keyFile: writeKey(), fetchImpl })).resolves.toBe(
            'Version increased to 1.2.0'
        )
        expect(calls[1]).toEqual({ url: URL_, options: { method: 'POST', headers: { Authorization: 'Bearer ID' } } })
    })

    it('fails on an HTTP error instead of passing like curl did', async () => {
        const fetchImpl = async url =>
            url.startsWith('https://oauth2.googleapis.com')
                ? { ok: true, status: 200, json: async () => ({ id_token: 'ID' }) }
                : { ok: false, status: 405, text: async () => 'Method not allowed' }
        await expect(bumpAppVersion({ url: URL_, keyFile: writeKey(), fetchImpl })).rejects.toThrow('405')
        await expect(bumpAppVersion({ url: URL_, keyFile: undefined, fetchImpl })).rejects.toThrow(
            'GOOGLE_APPLICATION_CREDENTIALS'
        )
    })

    it('is what both version jobs run, with the deploy credentials of their environment', () => {
        const ci = yaml.load(fs.readFileSync(path.join(__dirname, '..', '.gitlab-ci.yml'), 'utf8'))
        for (const [job, env] of [
            ['update:version:production', 'production'],
            ['update:version:staging', 'staging'],
        ]) {
            const script = ci[job].script.join('\n')
            expect(script).toContain(`useFirebaseDeployCredentials.sh ${env}`)
            expect(script).toContain('ci/bumpAppVersion.js')
            expect(script).not.toMatch(/\bcurl\b/)
        }
    })
})
