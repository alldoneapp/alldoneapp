jest.mock('firebase-admin', () => ({ storage: jest.fn(), firestore: jest.fn() }))

const {
    ASSISTANT_PHOTO_INPUT_FIELDS,
    MAX_ASSISTANT_PHOTO_BYTES,
    hasAssistantPhotoInput,
    prepareAssistantPhoto,
    storeAssistantPhoto,
} = require('./assistantPhoto')

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)])
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')

describe('assistant pictures (shared by MCP and assistant tools)', () => {
    it('knows which inputs ask for a picture change, an empty photoUrl included', () => {
        expect(ASSISTANT_PHOTO_INPUT_FIELDS).toEqual([
            'photoUrl',
            'photoArtifactId',
            'photoArtifactProjectId',
            'photoArtifactPath',
        ])
        expect(hasAssistantPhotoInput({})).toBe(false)
        expect(hasAssistantPhotoInput({ photoArtifactId: '' })).toBe(false)
        expect(hasAssistantPhotoInput({ photoUrl: '' })).toBe(true)
        expect(hasAssistantPhotoInput({ photoArtifactId: 'art1' })).toBe(true)
    })

    it('downloads a URL with the assistant size limit and stores it where the app keeps avatars', async () => {
        const downloadImage = jest.fn(async () => ({ buffer: PNG, contentType: 'image/png' }))
        const prepared = await prepareAssistantPhoto({
            input: { photoUrl: ' https://cdn.example.com/lead.png ' },
            projectId: 'p1',
            userId: 'u1',
            deps: { downloadImage },
        })
        expect(downloadImage).toHaveBeenCalledWith('https://cdn.example.com/lead.png', {
            maxBytes: MAX_ASSISTANT_PHOTO_BYTES,
        })
        expect(prepared).toMatchObject({
            contentType: 'image/png',
            source: { photoUrl: 'https://cdn.example.com/lead.png' },
        })

        const storePublicImage = jest.fn(async ({ filePath }) => `https://storage.googleapis.com/b/${filePath}`)
        const stored = await storeAssistantPhoto({
            prepared,
            projectId: 'p1',
            assistantId: 'a1',
            now: 7,
            deps: { storePublicImage },
        })
        expect(storePublicImage).toHaveBeenCalledWith({
            buffer: PNG,
            contentType: 'image/png',
            filePath: 'assistants/p1/a1/a1@7',
        })
        const url = 'https://storage.googleapis.com/b/assistants/p1/a1/a1@7'
        expect(stored).toEqual({
            fields: { photoURL: url, photoURL50: url, photoURL300: url },
            changed: 'photo',
            photoUrl: url,
        })
    })

    it('turns a failed download into the tool error, and refuses anything but a web URL before fetching', async () => {
        const downloadImage = jest.fn(async () => {
            throw new Error('The URL does not point to a JPEG, PNG, GIF or WebP image.')
        })
        await expect(
            prepareAssistantPhoto({ input: { photoUrl: 'https://x.example/a.svg' }, deps: { downloadImage } })
        ).rejects.toThrow('JPEG, PNG, GIF or WebP')
        await expect(
            prepareAssistantPhoto({ input: { photoUrl: 'file:///etc/passwd' }, deps: { downloadImage } })
        ).rejects.toThrow('https:// URL')
        await expect(
            prepareAssistantPhoto({ input: { photoUrl: 'lead.png' }, deps: { downloadImage } })
        ).rejects.toThrow('full https:// URL')
        expect(downloadImage).toHaveBeenCalledTimes(1)
    })

    it('removes a picture with an empty photoUrl, and changes nothing when there is none', async () => {
        const current = { photoURL: 'x', photoURL50: 'x', photoURL300: 'x' }
        const removal = await prepareAssistantPhoto({ input: { photoUrl: '' }, current })
        expect(removal).toEqual({ remove: true })
        expect(await storeAssistantPhoto({ prepared: removal })).toEqual({
            fields: { photoURL: '', photoURL50: '', photoURL300: '' },
            changed: 'photo removed',
            photoUrl: '',
        })

        const nothing = await prepareAssistantPhoto({ input: { photoUrl: '  ' }, current: {} })
        expect(nothing).toEqual({ unchanged: true })
        expect(await storeAssistantPhoto({ prepared: nothing })).toBeNull()
        expect(await prepareAssistantPhoto({ input: { name: 'x' } })).toBeNull()
    })

    it('refuses a URL and an artifact together', async () => {
        await expect(
            prepareAssistantPhoto({ input: { photoUrl: 'https://x.example/a.png', photoArtifactId: 'art1' } })
        ).rejects.toThrow('either photoUrl or photoArtifactId')
    })

    it("reads an artifact the user can read, defaulting to the assistant's project", async () => {
        const readArtifactFileForUser = jest.fn(async () => ({
            bytes: PNG,
            path: 'lead.png',
            artifactId: 'art1',
            versionNumber: 2,
        }))
        const prepared = await prepareAssistantPhoto({
            input: { photoArtifactId: 'art1' },
            projectId: 'p1',
            userId: 'u1',
            deps: { readArtifactFileForUser, db: 'db', bucket: 'bucket' },
        })
        expect(readArtifactFileForUser).toHaveBeenCalledWith(
            expect.objectContaining({
                db: 'db',
                bucket: 'bucket',
                projectId: 'p1',
                artifactId: 'art1',
                userId: 'u1',
                maxBytes: MAX_ASSISTANT_PHOTO_BYTES,
            })
        )
        expect(prepared).toMatchObject({
            buffer: PNG,
            contentType: 'image/png',
            source: { photoArtifactId: 'art1', photoArtifactProjectId: 'p1', path: 'lead.png', versionNumber: 2 },
        })

        await prepareAssistantPhoto({
            input: { photoArtifactId: 'art2', photoArtifactProjectId: 'p2', photoArtifactPath: 'img/a.png' },
            projectId: 'p1',
            userId: 'u1',
            deps: { readArtifactFileForUser, db: 'db', bucket: 'bucket' },
        })
        expect(readArtifactFileForUser).toHaveBeenLastCalledWith(
            expect.objectContaining({ projectId: 'p2', artifactId: 'art2', path: 'img/a.png' })
        )
    })

    it('refuses an artifact file that is not a raster image, SVG included', async () => {
        const readArtifactFileForUser = jest.fn(async () => ({ bytes: SVG, path: 'index.svg', artifactId: 'art1' }))
        await expect(
            prepareAssistantPhoto({
                input: { photoArtifactId: 'art1' },
                projectId: 'p1',
                userId: 'u1',
                deps: { readArtifactFileForUser, db: 'db', bucket: 'bucket' },
            })
        ).rejects.toThrow('index.svg is not a JPEG, PNG, GIF or WebP image')
    })

    it('passes on why an artifact could not be read', async () => {
        const readArtifactFileForUser = jest.fn(async () => {
            throw new Error('Artifact not found.')
        })
        await expect(
            prepareAssistantPhoto({
                input: { photoArtifactId: 'private' },
                projectId: 'p1',
                userId: 'u1',
                deps: { readArtifactFileForUser, db: 'db', bucket: 'bucket' },
            })
        ).rejects.toThrow('Artifact not found.')
    })
})
