/**
 * Tests for the Deepgram transcription call (PT-4648).
 *
 * These drive the REAL @deepgram/sdk against a mocked `fetch` rather than mocking the SDK itself.
 * The thing most likely to break here is the wire format — whether a `string[]` of keyterms is
 * serialized as the repeated `?keyterm=a&keyterm=b` params Deepgram documents, or quietly
 * comma-joined into one literal term. Deepgram does NOT error on the comma form: it accepts it,
 * treats it as a single keyterm and boosts nothing, so a mocked SDK would happily pass a test for
 * a configuration that silently does nothing in production.
 */

jest.mock('../envFunctionsHelper', () => ({
    getEnvFunctions: () => ({ DEEPGRAM_API_KEY: 'test-key' }),
}))

const {
    transcribeAudioBase64,
    buildTranscriptionOptions,
    formatTranscript,
    extractDetectedLanguages,
    stripDataUrlPrefix,
    isLikelyBadRequestError,
    DEEPGRAM_TRANSCRIPTION_OPTIONS,
} = require('./deepgramTranscribe')
const { getTranscriptionKeyterms } = require('../shared/transcriptionVocabulary')

const TRANSCRIPT_BODY = {
    results: { channels: [{ alternatives: [{ transcript: 'hello world' }] }] },
    metadata: { duration: 12.5 },
}

// jsdom does not expose the WHATWG `Response` global, so the fetch result is duck-typed to the
// members the SDK's fetcher actually reads: `status`, `text()` and a `headers` object supporting
// `get`/`entries`.
function jsonResponse(body, status = 200) {
    const headers = new Map([['content-type', 'application/json']])
    return {
        status,
        ok: status >= 200 && status < 300,
        headers,
        body: null,
        text: async () => JSON.stringify(body),
        json: async () => body,
    }
}

let requestUrls
let originalFetch

beforeEach(() => {
    requestUrls = []
    originalFetch = globalThis.fetch
    globalThis.fetch = jest.fn(async url => {
        requestUrls.push(String(url))
        return jsonResponse(TRANSCRIPT_BODY)
    })
})

afterEach(() => {
    globalThis.fetch = originalFetch
    jest.restoreAllMocks()
})

function queryOf(url) {
    return new URL(url).searchParams
}

describe('buildTranscriptionOptions', () => {
    test('keeps the base options untouched when there are no keyterms', () => {
        expect(buildTranscriptionOptions()).toEqual(DEEPGRAM_TRANSCRIPTION_OPTIONS)
        expect(buildTranscriptionOptions({ keyterms: [] })).not.toHaveProperty('keyterm')
    })

    test('attaches keyterms without mutating the shared base options', () => {
        const options = buildTranscriptionOptions({ keyterms: ['Alldone'] })
        expect(options.keyterm).toEqual(['Alldone'])
        expect(DEEPGRAM_TRANSCRIPTION_OPTIONS).not.toHaveProperty('keyterm')
    })

    test('pins the model to Nova-3, the only model that supports keyterm prompting', () => {
        expect(DEEPGRAM_TRANSCRIPTION_OPTIONS.model).toBe('nova-3')
    })

    // PT-4648. Both halves of this matter and they are easy to regress independently.
    test('sets an explicit multilingual language and never detect_language', () => {
        // `keyterm` requires an explicit language, and `detect_language` would silently downgrade
        // Nova-3 -> Nova-2 for languages Nova-3 lacks. Nova-2 does not support keyterm at all, so
        // reintroducing detection would kill the brand boost on exactly the requests nobody sees.
        expect(DEEPGRAM_TRANSCRIPTION_OPTIONS.language).toBe('multi')
        expect(DEEPGRAM_TRANSCRIPTION_OPTIONS).not.toHaveProperty('detect_language')
    })
})

describe('wire format', () => {
    test('serializes keyterms as repeated params, not a comma-joined literal', async () => {
        await transcribeAudioBase64('AAAA', { keyterms: ['Alldone', 'OpenClaw'] })

        expect(requestUrls).toHaveLength(1)
        const params = queryOf(requestUrls[0])
        expect(params.getAll('keyterm')).toEqual(['Alldone', 'OpenClaw'])
        // The silent-failure form: one keyterm containing a comma boosts nothing.
        expect(requestUrls[0]).not.toContain('keyterm=Alldone%2COpenClaw')
    })

    test('percent-encodes multi-word keyterms so they stay one phrase', async () => {
        await transcribeAudioBase64('AAAA', { keyterms: ['Karsten Wysk'] })

        expect(requestUrls[0]).toContain('keyterm=Karsten%20Wysk')
        expect(queryOf(requestUrls[0]).getAll('keyterm')).toEqual(['Karsten Wysk'])
    })

    // PT-4648 (per-user vocabulary): the earlier cases prove the SHAPE on two or three terms. A real
    // request now carries the static glossary plus up to 30 workspace terms — multi-word names with
    // non-ASCII letters among them — and that is the payload that actually goes out.
    test('serializes a full static + per-user vocabulary without dropping or mangling a term', async () => {
        const dynamic = [
            'Anna Somova',
            'Ralf Lämmel',
            "O'Brien",
            'Signal Iduna',
            'JTL Project Juno',
            ...Array.from({ length: 25 }, (_, index) => `Distinctname${index}`),
        ]
        const keyterms = getTranscriptionKeyterms(dynamic)
        await transcribeAudioBase64('AAAA', { keyterms })

        // Every term survives the round trip, in order, decoded back to exactly what was sent.
        expect(queryOf(requestUrls[0]).getAll('keyterm')).toEqual(keyterms)
        // Non-ASCII letters must be percent-encoded rather than sent raw or transliterated.
        expect(requestUrls[0]).toContain('keyterm=Ralf%20L%C3%A4mmel')
    })

    test('keeps a full vocabulary request well inside practical URL limits', async () => {
        // Keyterms ride in the query string, so an unbounded list would eventually produce a URL
        // servers reject (~8KB is the usual ceiling). The caps exist partly for this reason; this
        // pins that the realistic worst case is nowhere near it.
        const keyterms = getTranscriptionKeyterms(
            Array.from({ length: 30 }, (_, index) => `Verylongworkspacename Number${index}`)
        )
        await transcribeAudioBase64('AAAA', { keyterms })

        expect(requestUrls[0].length).toBeLessThan(4000)
    })

    test('sends the curated product vocabulary by default', async () => {
        await transcribeAudioBase64('AAAA')

        expect(queryOf(requestUrls[0]).getAll('keyterm')).toEqual(getTranscriptionKeyterms())
        expect(queryOf(requestUrls[0]).getAll('keyterm')).toContain('Alldone')
    })

    test('omits the parameter entirely when there are no keyterms', async () => {
        await transcribeAudioBase64('AAAA', { keyterms: [] })

        expect(requestUrls[0]).not.toContain('keyterm')
    })

    test('requests Nova-3 with the multilingual language, and no detect_language', async () => {
        await transcribeAudioBase64('AAAA')

        const params = queryOf(requestUrls[0])
        expect(params.get('model')).toBe('nova-3')
        expect(params.get('language')).toBe('multi')
        expect(params.get('detect_language')).toBeNull()
    })
})

describe('extractDetectedLanguages', () => {
    test('reads the word-level code-switching language list', () => {
        expect(extractDetectedLanguages({ results: { channels: [{ languages: ['de', 'en'] }] } })).toEqual(['de', 'en'])
    })

    test('falls back to a single detected_language tag', () => {
        expect(extractDetectedLanguages({ results: { channels: [{ detected_language: 'es' }] } })).toEqual(['es'])
    })

    test('returns an empty array on an unrecognised payload rather than throwing', () => {
        // An unexpected response shape must never cost the user their transcript.
        expect(extractDetectedLanguages({})).toEqual([])
        expect(extractDetectedLanguages(undefined)).toEqual([])
        expect(extractDetectedLanguages({ results: { channels: [{ languages: 'de' }] } })).toEqual([])
    })

    test('surfaces the detected languages on the transcription result', async () => {
        globalThis.fetch = jest.fn(async () =>
            jsonResponse({
                results: { channels: [{ alternatives: [{ transcript: 'hallo world' }], languages: ['de', 'en'] }] },
                metadata: { duration: 3 },
            })
        )

        expect((await transcribeAudioBase64('AAAA')).detectedLanguages).toEqual(['de', 'en'])
    })
})

describe('keyterm rejection fallback', () => {
    test('retries once without keyterms when the request is rejected', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {})
        globalThis.fetch = jest.fn(async url => {
            requestUrls.push(String(url))
            if (String(url).includes('keyterm')) {
                return jsonResponse({ err_code: 'Bad Request', err_msg: 'keyterm not supported' }, 400)
            }
            return jsonResponse(TRANSCRIPT_BODY)
        })

        const result = await transcribeAudioBase64('AAAA', { keyterms: ['Alldone'] })

        expect(requestUrls).toHaveLength(2)
        expect(requestUrls[0]).toContain('keyterm')
        expect(requestUrls[1]).not.toContain('keyterm')
        // The transcript still lands: losing the brand boost must never lose the dictation.
        expect(result.transcript).toBe('hello world')
        expect(result.keytermFallback).toBe(true)
        expect(result.keytermCount).toBe(0)
    })

    test('does NOT retry a transport failure', async () => {
        // A dropped connection is not the keyterms' fault; retrying just fails twice and doubles
        // the latency of an outage. (5xx is deliberately not used here: the SDK retries those
        // itself, so it would not isolate our own retry.)
        globalThis.fetch = jest.fn(async url => {
            requestUrls.push(String(url))
            throw new Error('socket hang up')
        })

        await expect(transcribeAudioBase64('AAAA', { keyterms: ['Alldone'] })).rejects.toThrow('socket hang up')
        expect(requestUrls).toHaveLength(1)
    })

    test('does not retry when there were no keyterms to blame', async () => {
        globalThis.fetch = jest.fn(async url => {
            requestUrls.push(String(url))
            return jsonResponse({ err_msg: 'bad request' }, 400)
        })

        await expect(transcribeAudioBase64('AAAA', { keyterms: [] })).rejects.toBeDefined()
        expect(requestUrls).toHaveLength(1)
    })

    test('reports keyterm count on the happy path', async () => {
        const result = await transcribeAudioBase64('AAAA', { keyterms: ['Alldone', 'OpenClaw'] })

        expect(result.keytermCount).toBe(2)
        expect(result.keytermFallback).toBe(false)
    })
})

describe('isLikelyBadRequestError', () => {
    test('treats 4xx as a rejected request and 5xx as an outage', () => {
        expect(isLikelyBadRequestError({ statusCode: 400 })).toBe(true)
        expect(isLikelyBadRequestError({ status: 422 })).toBe(true)
        expect(isLikelyBadRequestError({ response: { status: 400 } })).toBe(true)
        expect(isLikelyBadRequestError({ statusCode: 500 })).toBe(false)
        expect(isLikelyBadRequestError({ statusCode: 503 })).toBe(false)
    })

    test('falls back to the message when no status is available', () => {
        expect(isLikelyBadRequestError({ message: 'Keyterm limit exceeded' })).toBe(true)
        expect(isLikelyBadRequestError({ message: 'socket hang up' })).toBe(false)
        expect(isLikelyBadRequestError(undefined)).toBe(false)
    })
})

describe('response handling', () => {
    test('reports the duration Deepgram measured, not a client hint', async () => {
        const result = await transcribeAudioBase64('AAAA')
        expect(result.durationSeconds).toBe(12.5)
    })

    test('falls back to zero when the duration is missing or nonsensical', async () => {
        globalThis.fetch = jest.fn(async () => jsonResponse({ ...TRANSCRIPT_BODY, metadata: { duration: -1 } }))
        expect((await transcribeAudioBase64('AAAA')).durationSeconds).toBe(0)
    })

    test('prefers paragraphs over the flat transcript', () => {
        const withParagraphs = {
            results: {
                channels: [
                    {
                        alternatives: [
                            {
                                transcript: 'flat',
                                paragraphs: {
                                    paragraphs: [
                                        { sentences: [{ text: 'One.' }, { text: 'Two.' }] },
                                        { sentences: [{ text: 'Three.' }] },
                                    ],
                                },
                            },
                        ],
                    },
                ],
            },
        }
        expect(formatTranscript(withParagraphs)).toBe('One. Two.\n\nThree.')
    })

    test('returns an empty string rather than throwing on an empty result', () => {
        expect(formatTranscript({})).toBe('')
        expect(formatTranscript(undefined)).toBe('')
    })
})

describe('stripDataUrlPrefix', () => {
    test('strips the browser data-URL prefix, including codec parameters', () => {
        expect(stripDataUrlPrefix('data:audio/webm;codecs=opus;base64,QUJD')).toBe('QUJD')
        expect(stripDataUrlPrefix('data:audio/mp4;base64,QUJD')).toBe('QUJD')
    })

    test('leaves a bare base64 payload alone', () => {
        expect(stripDataUrlPrefix('QUJD')).toBe('QUJD')
    })
})
