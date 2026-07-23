'use strict'

const { THREAD_CONTEXT_MESSAGE_LIMIT } = require('./contextLimits')

describe('assistant context limits', () => {
    test('caps thread conversation history at 20 messages', () => {
        expect(THREAD_CONTEXT_MESSAGE_LIMIT).toBe(20)
    })
})
