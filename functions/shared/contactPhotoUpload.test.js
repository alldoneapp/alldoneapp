const dns = require('dns')

jest.mock('firebase-admin', () => ({ storage: jest.fn() }))

const { downloadImage, sniffImageType, uploadContactPhotoFromUrl } = require('./contactPhotoUpload')

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)])
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32)])

const response = (body, { status = 200, headers = {} } = {}) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    arrayBuffer: async () => Buffer.from(body),
})

beforeEach(() => {
    jest.spyOn(dns.promises, 'lookup').mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
})
afterEach(() => jest.restoreAllMocks())

describe('contact photo download (NV-29)', () => {
    test('stores a real image with the type its bytes declare', async () => {
        const fetchImpl = jest.fn(async () => response(PNG, { headers: { 'content-type': 'text/plain' } }))
        const save = jest.fn()
        const makePublic = jest.fn()
        const bucket = { name: 'b', file: jest.fn(() => ({ save, makePublic })) }
        const url = await uploadContactPhotoFromUrl('https://cdn.example.com/a.png', 'p1', 'c1', {
            fetchImpl,
            bucket,
            now: 1,
        })
        expect(url).toBe('https://storage.googleapis.com/b/projectsContacts/p1/c1/c1@1')
        expect(save).toHaveBeenCalledWith(PNG, { metadata: { contentType: 'image/png' } })
        expect(fetchImpl.mock.calls[0][1].redirect).toBe('manual')
    })

    test('refuses a text body even when the URL ends in .png', async () => {
        const fetchImpl = jest.fn(async () => response('internal-secret', { headers: { 'content-type': 'image/png' } }))
        await expect(downloadImage('https://cdn.example.com/x?y=.png', { fetchImpl })).rejects.toThrow(
            /does not point to a JPEG, PNG, GIF or WebP/
        )
    })

    test('refuses SVG, which can carry script', async () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        const fetchImpl = jest.fn(async () => response(svg, { headers: { 'content-type': 'image/svg+xml' } }))
        await expect(downloadImage('https://cdn.example.com/a.svg', { fetchImpl })).rejects.toThrow()
    })

    test('never requests a private address, literal or resolved', async () => {
        const fetchImpl = jest.fn()
        await expect(downloadImage('http://169.254.169.254/latest/a.png', { fetchImpl })).rejects.toThrow(
            /private or internal/
        )
        dns.promises.lookup.mockResolvedValue([{ address: '127.0.0.1', family: 4 }])
        await expect(downloadImage('https://evil.example.com/a.png', { fetchImpl })).rejects.toThrow(
            /private or internal/
        )
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    test('re-checks a redirect hop instead of following it inward', async () => {
        const fetchImpl = jest.fn(async () =>
            response('', { status: 302, headers: { location: 'http://127.0.0.1:8080/internal-secret' } })
        )
        await expect(downloadImage('https://cdn.example.com/public.png', { fetchImpl })).rejects.toThrow(
            /private or internal/
        )
        expect(fetchImpl).toHaveBeenCalledTimes(1)
    })

    test('reports HTTP errors and network errors the same way', async () => {
        const notFound = jest.fn(async () => response('', { status: 404 }))
        const refused = jest.fn(async () => {
            throw new Error('connect ECONNREFUSED')
        })
        const a = await downloadImage('https://cdn.example.com/a.png', { fetchImpl: notFound }).catch(e => e.message)
        const b = await downloadImage('https://cdn.example.com/a.png', { fetchImpl: refused }).catch(e => e.message)
        expect(a).toBe(b)
    })

    test('sniffs the supported raster types', () => {
        expect(sniffImageType(JPEG)).toBe('image/jpeg')
        expect(sniffImageType(Buffer.from('GIF89a______'))).toBe('image/gif')
        expect(sniffImageType(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
        expect(sniffImageType(Buffer.from('<html>hello</html>'))).toBe(null)
    })
})
