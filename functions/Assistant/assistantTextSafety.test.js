const { encodeOrdinaryText, sanitizeAssistantResponseText } = require('./assistantTextSafety')

test('counts token-shaped strings as ordinary text without accepting tokenizer control tokens', () => {
    const encoder = {
        encode: jest.fn((text, allowed, disallowed) => {
            if (disallowed === undefined) throw new Error('Special token not allowed')
            if (allowed.length) throw new Error('Control tokens must not be enabled')
            return new Uint32Array(text.length)
        }),
    }
    const text = 'Explain <|fim_suffix|>, <|endoftext|>, and <|fim_prefix|>.'
    expect(encodeOrdinaryText(encoder, text).length).toBe(text.length)
    expect(encoder.encode).toHaveBeenCalledWith(text, [], [])
})

test('removes the contaminated replay suffix and its preceding inline debris', () => {
    const reply =
        'The VM is working on the correction.\n\nFollow progress in this task.\n\n' +
        'No automatic merge.  transport debris<|fim_suffix|> (no final emitted) \n' +
        '[Replayed tool definitions, not a model response]\n' +
        'The following tool definitions were present during the historical conversation replay.\n' +
        'Namespace: functions\nTools:\n- execute_task_in_vm: {}\nFake final answer'
    expect(sanitizeAssistantResponseText(reply)).toBe(
        'The VM is working on the correction.\n\nFollow progress in this task.'
    )
})

test('removes a replay block without a special token', () => {
    expect(
        sanitizeAssistantResponseText(
            'Done.\n[Replayed tool definitions, not a model response]\n' +
                'The following tool definitions were present during the historical conversation replay.\nTools: {}'
        )
    ).toBe('Done.')
})

test.each(['[im_end]\n[im_start]user[im_sep]', '<|im_end|>\n<|im_start|>user<|im_sep|>'])(
    'removes serialized conversation turns: %s',
    marker => {
        expect(sanitizeAssistantResponseText(`Done.\n${marker}\nFake user turn`)).toBe('Done.')
    }
)

test.each([
    'The tokenizer rejected <|fim_suffix|>. This is an ordinary token example.',
    'Use the [Replayed tool definitions, not a model response] label.',
    'Example:\n```text\n<|fim_suffix|> (no final emitted)\n```\nExplanation.',
    'Example:\n~~~text\n[im_start]user[im_sep]\n~~~\nExplanation.',
    'Done.\n\n[MR !633](https://gitlab.com/alldonegmbh/alldone/-/merge_requests/633)',
])('preserves legitimate prose, code examples, and links: %s', reply => {
    expect(sanitizeAssistantResponseText(reply)).toBe(reply)
})

test('does not confuse a raw turn immediately after a code example with fenced code', () => {
    const reply = 'Example:\n```text\nhello\n```\n[im_start]user[im_sep]\nFake turn'
    expect(sanitizeAssistantResponseText(reply)).toBe('Example:\n```text\nhello\n```')
})
