const { isGoogleIdentityToken, isVersionFunctionAudience, verifyDeployIdentityToken } = require('./versionBumpAuth')

const fakeToken = payload => `h.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.s`
const AUD = 'https://europe-west1-alldonealeph.cloudfunctions.net/increaseVersionSecondGen'
const clientReturning = payload => ({ verifyIdToken: jest.fn(async () => ({ getPayload: () => payload })) })

describe('versionBumpAuth', () => {
    it('tells Google identity tokens from Firebase ID tokens', () => {
        expect(isGoogleIdentityToken(fakeToken({ iss: 'https://accounts.google.com' }))).toBe(true)
        expect(isGoogleIdentityToken(fakeToken({ iss: 'https://securetoken.google.com/alldonealeph' }))).toBe(false)
        expect(isGoogleIdentityToken('garbage')).toBe(false)
    })

    it('accepts only this function as audience', () => {
        expect(isVersionFunctionAudience(AUD)).toBe(true)
        expect(isVersionFunctionAudience('https://increaseversionsecondgen-abc-ew.a.run.app')).toBe(true)
        expect(isVersionFunctionAudience('https://europe-west1-alldonealeph.cloudfunctions.net/otherFunction')).toBe(
            false
        )
        expect(isVersionFunctionAudience('https://othersvc-abc-ew.a.run.app')).toBe(false)
        expect(isVersionFunctionAudience('http://europe-west1-x.cloudfunctions.net/increaseVersionSecondGen')).toBe(
            false
        )
    })

    it('accepts a verified service account of this project', async () => {
        const payload = {
            iss: 'https://accounts.google.com',
            aud: AUD,
            email: 'deploy@alldonealeph.iam.gserviceaccount.com',
            email_verified: true,
        }
        const client = clientReturning(payload)
        await expect(
            verifyDeployIdentityToken(fakeToken(payload), { projectId: 'alldonealeph', client })
        ).resolves.toBe(payload.email)
        expect(client.verifyIdToken).toHaveBeenCalledWith({ idToken: fakeToken(payload), audience: AUD })
    })

    it('rejects other accounts, other projects and other audiences', async () => {
        const base = { iss: 'https://accounts.google.com', aud: AUD, email_verified: true }
        const run = payload =>
            verifyDeployIdentityToken(fakeToken(payload), {
                projectId: 'alldonealeph',
                client: clientReturning(payload),
            })
        await expect(run({ ...base, email: 'someone@gmail.com' })).rejects.toThrow('not a service account')
        await expect(run({ ...base, email: 'deploy@alldonestaging.iam.gserviceaccount.com' })).rejects.toThrow(
            'not a service account'
        )
        await expect(
            run({ ...base, email: 'deploy@alldonealeph.iam.gserviceaccount.com', email_verified: false })
        ).rejects.toThrow('unverified')
        await expect(
            run({ ...base, aud: 'https://example.com/', email: 'deploy@alldonealeph.iam.gserviceaccount.com' })
        ).rejects.toThrow('audience')
    })

    it('lets a failed signature check reject', async () => {
        const client = {
            verifyIdToken: jest.fn(async () => {
                throw new Error('Invalid token signature')
            }),
        }
        await expect(
            verifyDeployIdentityToken(fakeToken({ iss: 'https://accounts.google.com', aud: AUD }), {
                projectId: 'alldonealeph',
                client,
            })
        ).rejects.toThrow('signature')
    })
})
