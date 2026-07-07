'use strict'

const TASK_PRIORITIZATION_SKILL_ID = 'task-prioritization'
const TASK_PRIORITIZATION_OVERLAY_TYPE = 'taskPriorityLearning'

const TASK_PRIORITIZATION_SKILL_BODY = [
    '# Task prioritization',
    '',
    'Use this skill before ranking tasks, planning today, or assigning task priorities with update_task.',
    '',
    'Priority meanings (highest to lowest):',
    '- must_do: needs attention today because it is due, blocking, externally committed, or clearly tied to an urgent objective.',
    '- should_do: important and worth doing soon, but not a hard today commitment.',
    '- could_do: useful if time and energy allow.',
    '- do_later: intentionally defer; low urgency or low value right now.',
    '- none: no priority yet; use when there is not enough evidence to rank the task.',
    '',
    'Decision method:',
    '- Start with explicit user instructions and commitments.',
    '- Consider due dates, overdue status, reminders, calendar load, available time, and time of day.',
    '- Prefer tasks tied to active OKRs, dependencies, external stakeholders, deadlines, and current focus.',
    '- Consider effort, energy fit, project balance, and whether the task unlocks other work.',
    '- Prefer the lower priority when evidence is weak.',
    '- Keep must_do realistic for a single day; do not inflate every task to must_do or the ranking loses meaning.',
    "- Apply user-specific prioritization rules when present unless today's facts clearly conflict.",
    '',
    'Presenting a prioritized list:',
    '- Group tasks first by priority, then by project within each priority group.',
    '- Order the priority groups from highest to lowest: Must do, Should do, Could do, Do later, then No priority (omit No priority unless the user asked to see unranked tasks).',
    '- Use the priority label as the top-level heading and each project name as a sub-heading beneath it. Skip any priority group that has no tasks.',
    '- Within a project, order tasks by urgency: overdue first, then by soonest due date, then by your ranking.',
    '- Keep each task to a short line; add the due date or a brief reason only when it aids the decision.',
    '',
    'Example shape:',
    'Must do',
    '- Project Alpha',
    '  - Ship the release notes (due today)',
    '- Project Beta',
    '  - Reply to the client contract email (overdue)',
    'Should do',
    '- Project Alpha',
    '  - Review the onboarding draft',
    '',
    'When calling update_task with must_do, should_do, could_do, or do_later, include a concise comment explaining the priority choice.',
].join('\n')

const TASK_PRIORITIZATION_SKILL = {
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

const BUILT_IN_ASSISTANT_SKILLS = [TASK_PRIORITIZATION_SKILL]

function isTaskPrioritizationSkill(skillOrName) {
    if (typeof skillOrName === 'string') return skillOrName === TASK_PRIORITIZATION_SKILL_ID
    return skillOrName?.uid === TASK_PRIORITIZATION_SKILL_ID || skillOrName?.name === TASK_PRIORITIZATION_SKILL_ID
}

function findBuiltInSkill(skillIdOrName) {
    return BUILT_IN_ASSISTANT_SKILLS.find(skill => skill.uid === skillIdOrName || skill.name === skillIdOrName) || null
}

function mergeBuiltInAssistantSkills(skills = []) {
    const normalizedSkills = Array.isArray(skills) ? skills : []
    const existingKeys = new Set(
        normalizedSkills.flatMap(skill => [skill?.uid, skill?.name].filter(value => typeof value === 'string'))
    )
    const missingBuiltIns = BUILT_IN_ASSISTANT_SKILLS.filter(
        skill => !existingKeys.has(skill.uid) && !existingKeys.has(skill.name)
    )
    return [...missingBuiltIns, ...normalizedSkills]
}

module.exports = {
    TASK_PRIORITIZATION_SKILL_ID,
    TASK_PRIORITIZATION_OVERLAY_TYPE,
    TASK_PRIORITIZATION_SKILL,
    TASK_PRIORITIZATION_SKILL_BODY,
    BUILT_IN_ASSISTANT_SKILLS,
    isTaskPrioritizationSkill,
    findBuiltInSkill,
    mergeBuiltInAssistantSkills,
}
