const {
    OMITTED_IMAGE_NOTE,
    isImageDownloadError,
    stripInputImagesFromResponsesInput,
} = require('./imageDownloadFallback')

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
