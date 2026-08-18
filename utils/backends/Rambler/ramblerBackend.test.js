const mockRunHttpsCallableFunction = jest.fn(async () => ({ text: 'cleaned' }))
jest.mock('../firestore', () => ({
    runHttpsCallableFunction: (...args) => mockRunHttpsCallableFunction(...args),
}))

import { processRamble, PROCESS_RAMBLE_TIMEOUT_MS } from './ramblerBackend'

describe('processRamble backend wrapper', () => {
    test('calls the callable with an explicit long timeout — the SDK default (~70s) is too short for audio + LLM', async () => {
        const params = {
            projectId: 'p1',
            audio: 'data:audio/webm;base64,AAAA',
            mimeType: 'audio/webm',
            targetKind: 'title',
            currentText: 'draft',
            durationSeconds: 42,
            language: 'de',
        }
        const result = await processRamble(params)

        expect(mockRunHttpsCallableFunction).toHaveBeenCalledWith('processRambleSecondGen', params, {
            timeout: PROCESS_RAMBLE_TIMEOUT_MS,
        })
        expect(PROCESS_RAMBLE_TIMEOUT_MS).toBeGreaterThanOrEqual(120000)
        expect(result).toEqual({ text: 'cleaned' })
    })
})
