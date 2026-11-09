const fs = require('fs')
const path = require('path')

/**
 * Source-level ratchet over the two server paths that run an assistant in a thread (AT-2502).
 *
 * `assistantNormalTalk_optimized.js` has no unit suite — it is the top of a module graph that
 * reaches OpenAI clients, tiktoken and half of `assistantHelper`, and standing that up would test
 * the doubles rather than the behaviour. But the two things that would break this feature are
 * both visible in the source, and both fail SILENTLY in production:
 *
 * 1. Dropping the override read — the pin simply stops applying, the assistant answers on the
 *    assistant's model, and nothing anywhere reports a problem.
 *
 * 2. Assigning the resolved model back onto the assistant object. `getAssistantForChat` returns
 *    an object out of a module-level cache keyed on (projectId, assistantId), shared by every
 *    thread a warm instance serves. `assistant.model = …` would therefore leak ONE conversation's
 *    pin into the next conversation with the same assistant — a wrong model and a wrong Gold rate
 *    for a thread that never pinned anything, disappearing whenever the instance recycles. That
 *    is the shape of bug this file exists to prevent.
 *
 * Same idea as `assistantRunLimits.test.js` and `assistantRunIdempotencyHosts.test.js`.
 */

const readSource = file => fs.readFileSync(path.join(__dirname, file), 'utf8')

describe('per-thread model override call sites (AT-2502)', () => {
    describe('the interactive chat path', () => {
        const source = readSource('assistantNormalTalk_optimized.js')

        it('reads the thread override and resolves the model through the shared resolver', () => {
            expect(source).toContain("require('./threadAssistantModelStore')")
            expect(source).toContain('readThreadAssistantModelOverride(')
            expect(source).toContain('resolveThreadAssistantModel({')
        })

        it('reads it alongside the user and assistant rather than adding a round trip', () => {
            const parallelBlock = source.slice(
                source.indexOf('const [user, assistant'),
                source.indexOf('const step1Duration')
            )
            expect(parallelBlock).toContain('Promise.all(')
            expect(parallelBlock).toContain('readThreadAssistantModelOverride(')
        })

        // The cache-poisoning trap.
        it('never writes the resolved model back onto the cached assistant', () => {
            expect(source).not.toMatch(/assistant\.model\s*=[^=]/)
            expect(source).not.toMatch(/assistant\[['"]model['"]\]\s*=[^=]/)
            expect(source).not.toMatch(/Object\.assign\(\s*assistant\b/)
        })

        // Everything downstream — the context budget, the request and the Gold charge — has to
        // agree on which model ran, or the user is billed at one model's rate for another's work.
        it('feeds the resolved model to the request, the context budget and the Gold charge', () => {
            const runBlock = source.slice(source.indexOf('const { model, source: modelSource }'))
            expect(runBlock).toContain('generateContextOptimized(messages, model)')
            expect(runBlock).toMatch(/interactWithChatStream\(\s*contextMessages,\s*model,/)
            expect(runBlock).toMatch(/reduceGoldWhenChatWithAI\(userId, user\.gold, model,/)
        })
    })

    describe('the pre-configured prompt path', () => {
        const helperSource = readSource('assistantHelper.js')
        const topicSource = readSource('assistantPreConfigTaskTopic.js')

        it('resolves task, thread and assistant models through the shared resolver', () => {
            const block = helperSource.slice(
                helperSource.indexOf('async function getTaskOrAssistantSettings'),
                helperSource.indexOf('async function resolveCurrentAssistantDocForToolExecution')
            )
            expect(block).toContain('resolveThreadAssistantModel({')
            expect(block).toContain('explicitModel: taskModelOverride')
            expect(block).toContain('threadOverride: threadModelOverride')
            expect(block).toContain('assistantModel: assistant.model')
        })

        it('is told which thread the prompt is running in', () => {
            expect(topicSource).toContain(
                'getTaskOrAssistantSettings(projectId, objectId, assistantId, { objectType, objectId })'
            )
        })
    })
})
