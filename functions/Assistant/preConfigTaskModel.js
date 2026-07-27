const { SELECTABLE_ASSISTANT_MODELS } = require('./selectableAssistantModels')

const INHERIT_ASSISTANT_MODEL = 'INHERIT_ASSISTANT_MODEL'
const PRE_CONFIG_TASK_MODEL_OPTIONS = SELECTABLE_ASSISTANT_MODELS.map(({ model, labelKey }) => ({
    labelKey,
    value: model,
}))

function getPreConfigTaskModelOverride(task) {
    const model = task?.aiModelOverride
    return typeof model === 'string' && model.trim() ? model : null
}

function getPreConfigTaskModelSelection(task) {
    return getPreConfigTaskModelOverride(task) || INHERIT_ASSISTANT_MODEL
}

module.exports = {
    INHERIT_ASSISTANT_MODEL,
    PRE_CONFIG_TASK_MODEL_OPTIONS,
    getPreConfigTaskModelOverride,
    getPreConfigTaskModelSelection,
}
