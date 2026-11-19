const {
    OMITTED_IMAGE_NOTE,
    DUPLICATE_IMAGE_NOTE,
    normalizeResponsesImageInput,
    isImageDownloadError,
    stripInputImagesFromResponsesInput,
} = require('./imageDownloadFallback')

describe('normalizeResponsesImageInput', () => {
    test('keeps the latest screenshot and removes abbreviated URLs before preflight without changing saved input', () => {
        const image = { type: 'input_image', image_url: 'https://example.com/screenshot.png', detail: 'auto' }
        const input = [
            { role: 'system', content: 'Keep all instructions' },
            {
                role: 'user',
                content: [
                    { type: 'input_text', text: 'Task description image' },
                    { type: 'input_image', image_url: 'https://storage.googleapis.com/b/%2E%2E%2E' },
                    image,
                ],
            },
            { type: 'function_call_output', call_id: 'c1', output: '{}' },
            { role: 'user', content: [{ type: 'input_text', text: 'Try this screenshot' }, image] },
        ]
        const original = JSON.stringify(input)
        const result = normalizeResponsesImageInput(input)
        expect(result).toEqual(expect.objectContaining({ omittedCount: 1, duplicateCount: 1 }))
        expect(result.input[1].content).toEqual([
            input[1].content[0],
            { type: 'input_text', text: OMITTED_IMAGE_NOTE },
            { type: 'input_text', text: DUPLICATE_IMAGE_NOTE },
        ])
        expect(result.input[0]).toBe(input[0])
        expect(result.input[2]).toBe(input[2])
        expect(result.input[3]).toBe(input[3])
        expect(JSON.stringify(input)).toBe(original)
    })

    test('keeps distinct images and detail levels, deduplicates inline and file-id images', () => {
        const inline = { type: 'input_image', image_url: 'data:image/png;base64,aB12', detail: 'auto' }
        const file = { type: 'input_image', file_id: 'file-image', detail: 'auto' }
        const input = [
            {
                role: 'user',
                content: [
                    inline,
                    file,
                    { type: 'input_image', image_url: 'https://example.com/a.png', detail: 'low' },
                    { type: 'input_image', image_url: 'https://example.com/a.png', detail: 'high' },
                    { type: 'input_image', image_url: 'https://example.com/b.png' },
                    inline,
                    file,
                ],
            },
        ]
        const result = normalizeResponsesImageInput(input)
        expect(result.duplicateCount).toBe(2)
        expect(result.omittedCount).toBe(0)
        expect(result.input[0].content.filter(part => part.type === 'input_image')).toEqual(input[0].content.slice(2))
        expect(normalizeResponsesImageInput(result.input).input).toBe(result.input)
    })

    test('keeps real filenames and query values containing ellipses', () => {
        const input = [
            {
                role: 'user',
                content: [
                    { type: 'input_image', image_url: 'https://example.com/design...final.png?signature=...' },
                    { type: 'input_image', image_url: 'https://example.com/design%E2%80%A6final.png' },
                ],
            },
        ]
        expect(normalizeResponsesImageInput(input)).toEqual({ input, omittedCount: 0, duplicateCount: 0 })
    })

    test('keeps text-only inputs untouched', () => {
        const input = [{ role: 'user', content: 'Hello' }]
        expect(normalizeResponsesImageInput(input)).toEqual({ input, omittedCount: 0, duplicateCount: 0 })
        expect(normalizeResponsesImageInput(undefined)).toEqual({
            input: undefined,
            omittedCount: 0,
            duplicateCount: 0,
        })
    })
})

describe('isImageDownloadError', () => {
    test('recognises the OpenAI error for an image it could not download', () => {
        const error = Object.assign(new Error('400 Error while downloading file. Upstream status code: 403.'), {
            status: 400,
        })
        expect(isImageDownloadError(error)).toBe(true)
        expect(isImageDownloadError({ status: 400, code: 'invalid_image_url', message: 'bad' })).toBe(true)
    })

    test('leaves other errors alone', () => {
        expect(isImageDownloadError(null)).toBe(false)
        expect(isImageDownloadError({ status: 400, message: 'Invalid tool schema' })).toBe(false)
        expect(isImageDownloadError({ status: 500, message: 'Error while downloading file' })).toBe(false)
        expect(isImageDownloadError({ status: 429, message: 'Rate limit' })).toBe(false)
    })
})

describe('stripInputImagesFromResponsesInput', () => {
    test('replaces every input_image with a note and keeps everything else', () => {
        const input = [
            { role: 'system', content: 'Be helpful' },
            {
                role: 'user',
                content: [
                    { type: 'input_text', text: 'See screenshot' },
                    { type: 'input_image', image_url: 'https://storage.googleapis.com/b/...', detail: 'auto' },
                ],
            },
            { type: 'function_call_output', call_id: 'c1', output: '{}' },
            {
                role: 'user',
                content: [{ type: 'input_image', image_url: 'https://example.com/a.png', detail: 'auto' }],
            },
        ]

        const result = stripInputImagesFromResponsesInput(input)

        expect(result.removedCount).toBe(2)
        expect(result.input[0]).toBe(input[0])
        expect(result.input[2]).toBe(input[2])
        expect(result.input[1].content).toEqual([
            { type: 'input_text', text: 'See screenshot' },
            { type: 'input_text', text: OMITTED_IMAGE_NOTE },
        ])
        expect(result.input[3].content).toEqual([{ type: 'input_text', text: OMITTED_IMAGE_NOTE }])
        // The original request is not mutated.
        expect(input[1].content[1].type).toBe('input_image')
    })

    test('returns the same input when there is no image', () => {
        const input = [{ role: 'user', content: [{ type: 'input_text', text: 'hi' }] }]
        expect(stripInputImagesFromResponsesInput(input)).toEqual({ input, removedCount: 0 })
        expect(stripInputImagesFromResponsesInput(undefined)).toEqual({ input: undefined, removedCount: 0 })
    })
})
