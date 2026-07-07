export const TASK_PRIORITIZATION_SKILL_ID = 'task-prioritization'
export const TASK_PRIORITIZATION_OVERLAY_TYPE = 'taskPriorityLearning'

export const TASK_PRIORITIZATION_SKILL_BODY = [
    '# Task prioritization',
    '',
    'Use this skill before ranking tasks, planning today, or assigning task priorities with update_task.',
    '',
    'Priority meanings:',
    '- must_do: needs attention today because it is due, blocking, externally committed, or clearly tied to an urgent objective.',
    '- should_do: important and worth doing soon, but not a hard today commitment.',
    '- could_do: useful if time and energy allow.',
    '- do_later: intentionally defer; low urgency or low value right now.',
    '- none: clear priority when there is not enough evidence to rank the task.',
    '',
    'Decision method:',
    '- Start with explicit user instructions and commitments.',
    '- Consider due dates, overdue status, reminders, calendar load, available time, and time of day.',
    '- Prefer tasks tied to active OKRs, dependencies, external stakeholders, deadlines, and current focus.',
    '- Consider effort, energy fit, project balance, and whether the task unlocks other work.',
    '- Prefer the lower priority when evidence is weak.',
    '- Apply user-specific prioritization rules when present unless today\'s facts clearly conflict.',
    '',
    'When calling update_task with must_do, should_do, could_do, or do_later, include a concise comment explaining the priority choice.',
].join('\n')

export const TASK_PRIORITIZATION_SKILL = {
    uid: TASK_PRIORITIZATION_SKILL_ID,
    name: TASK_PRIORITIZATION_SKILL_ID,
    displayName: 'Task prioritization',
    description:
        "Use when prioritizing tasks, ranking today's work, deciding must/should/could/do_later, or calling update_task with priority.",
    body: TASK_PRIORITIZATION_SKILL_BODY,
    files: [],
    enabled: true,
    source: { type: 'builtin' },
    personalOverlayType: TASK_PRIORITIZATION_OVERLAY_TYPE,
}

export const BUILT_IN_ASSISTANT_SKILLS = [TASK_PRIORITIZATION_SKILL]

export function supportsPersonalOverlay(skill) {
    return skill?.personalOverlayType === TASK_PRIORITIZATION_OVERLAY_TYPE || skill?.name === TASK_PRIORITIZATION_SKILL_ID
}

export function mergeBuiltInAssistantSkills(skills = []) {
    const normalizedSkills = Array.isArray(skills) ? skills : []
    const existingKeys = new Set(
        normalizedSkills.flatMap(skill => [skill?.uid, skill?.name].filter(value => typeof value === 'string'))
    )

    const missingBuiltIns = BUILT_IN_ASSISTANT_SKILLS.filter(
        skill => !existingKeys.has(skill.uid) && !existingKeys.has(skill.name)
    )

    return [...missingBuiltIns, ...normalizedSkills]
}
