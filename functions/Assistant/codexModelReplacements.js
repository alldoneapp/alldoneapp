/**
 * Superseded OpenAI releases → the release a saved Codex (VM agent) choice now runs on (AT-3163).
 *
 * A concrete id can be saved in user settings, on a task's run override or in a cached catalog.
 * Each entry here follows the newest release of its family in OpenAI's model list
 * (developers.openai.com/api/docs/models, checked 2026-11-26), so a stale choice keeps working
 * on the current model instead of staying on an old one. Jobs already started keep the model
 * and the Gold rate persisted on their job doc.
 *
 * Dependency-free so the job, runner and catalog modules can share it.
 */
const CODEX_MODEL_REPLACEMENTS = Object.freeze({
    'gpt-6-astra': 'gpt-6.2-astra',
    'gpt-6-sol': 'gpt-6.2-sol',
    'gpt-6.1-sol': 'gpt-6.2-sol',
    'gpt-5.6-terra': 'gpt-6.1-terra',
})

function replaceSupersededCodexModel(modelId) {
    return (typeof modelId === 'string' && CODEX_MODEL_REPLACEMENTS[modelId]) || modelId
}

module.exports = { CODEX_MODEL_REPLACEMENTS, replaceSupersededCodexModel }
