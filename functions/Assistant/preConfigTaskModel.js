const INHERIT_ASSISTANT_MODEL = 'INHERIT_ASSISTANT_MODEL'
const PRE_CONFIG_TASK_MODEL_OPTIONS = [
    { labelKey: 'GPT 3_5', value: 'MODEL_GPT3_5' },
    { labelKey: 'GPT 4', value: 'MODEL_GPT4' },
    { labelKey: 'GPT 4o', value: 'MODEL_GPT4O' },
    { labelKey: 'GPT 5_1', value: 'MODEL_GPT5_1' },
    { labelKey: 'GPT 5_6 Sol', value: 'MODEL_GPT5_6_SOL' },
    { labelKey: 'GPT 5_6 Terra', value: 'MODEL_GPT5_6_TERRA' },
    { labelKey: 'GPT 5_6 Luna', value: 'MODEL_GPT5_6_LUNA' },
    { labelKey: 'GPT 5_5', value: 'MODEL_GPT5_5' },
    { labelKey: 'Sonar', value: 'MODEL_SONAR' },
    { labelKey: 'Sonar Pro', value: 'MODEL_SONAR_PRO' },
    { labelKey: 'Sonar Reasoning', value: 'MODEL_SONAR_REASONING' },
    { labelKey: 'Sonar Reasoning Pro', value: 'MODEL_SONAR_REASONING_PRO' },
    { labelKey: 'Sonar Deep Research', value: 'MODEL_SONAR_DEEP_RESEARCH' },
]

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
