const {
    buildOnDemandAssistantTaskMetadata,
    requestsOnDemandAssistantTaskCompletion,
    shouldUseClientTaskCompletionFallback,
} = require('./assistantTaskCompletionContract')

describe('assistant task completion contract', () => {
    test('adds completion provenance without dropping existing task metadata', () => {
        const metadata = buildOnDemandAssistantTaskMetadata({ sendWhatsApp: false, executionMode: 'direct' })

        expect(metadata).toEqual({
            sendWhatsApp: false,
            executionMode: 'direct',
            assistantCompletion: {
                mode: 'server_on_success',
                source: 'preconfigured_prompt',
            },
        })
        expect(requestsOnDemandAssistantTaskCompletion(metadata)).toBe(true)
    })

    test('requires the exact completion mode and source', () => {
        expect(requestsOnDemandAssistantTaskCompletion()).toBe(false)
        expect(
            requestsOnDemandAssistantTaskCompletion({
                assistantCompletion: { mode: 'server_on_success', source: 'other' },
            })
        ).toBe(false)
    })

    test('uses the client only when the server did not confirm completion', () => {
        expect(shouldUseClientTaskCompletionFallback()).toBe(true)
        expect(shouldUseClientTaskCompletionFallback({ status: 'failed' })).toBe(true)
        expect(shouldUseClientTaskCompletionFallback({ status: 'rejected' })).toBe(true)
        expect(shouldUseClientTaskCompletionFallback({ status: 'succeeded' })).toBe(false)
    })
})
