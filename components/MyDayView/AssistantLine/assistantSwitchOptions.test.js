import {
    buildAllProjectsAssistantGroups,
    buildProjectAssistantOptions,
    buildSingleAssistantGroup,
    countAssistantOptions,
    findAssistantOption,
    flattenAssistantGroups,
    getToggleTargetOption,
    orderProjectsForAssistantSwitch,
} from './assistantSwitchOptions'

jest.mock('../../../i18n/TranslationService', () => ({ translate: key => key }))

const assistant = (uid, displayName, description = '') => ({ uid, displayName, description })

const project = (id, name, extra = {}) => ({ id, name, globalAssistantIds: [], ...extra })

const DEFAULT_PROJECT_ID = 'default-project'
const defaultAssistant = assistant('anna', 'Anna Alldone', 'AI Chief of Staff')

describe('buildProjectAssistantOptions', () => {
    it('keeps the order the assignment picker uses: global assistants, then the project’s own', () => {
        const options = buildProjectAssistantOptions({
            project: project('p1', 'Marketing', { globalAssistantIds: ['g1'] }),
            projectAssistants: [assistant('a1', 'Marty Marketing'), assistant('a2', 'Derek Designer')],
            globalAssistants: [assistant('g1', 'Global One'), assistant('g2', 'Not in this project')],
            defaultProjectId: DEFAULT_PROJECT_ID,
            defaultAssistant,
        })

        expect(options.map(option => option.assistantId)).toEqual(['g1', 'a1', 'a2', 'anna'])
        // A global assistant the project has not enabled is not an option in it.
        expect(options.some(option => option.assistantId === 'g2')).toBe(false)
    })

    it('labels the trailing default-project entry and leaves the other rows’ descriptions alone', () => {
        const options = buildProjectAssistantOptions({
            project: project('p1', 'Marketing'),
            projectAssistants: [assistant('a1', 'Marty Marketing', 'Runs campaigns')],
            defaultProjectId: DEFAULT_PROJECT_ID,
            defaultAssistant,
        })

        expect(options[0].assistant.description).toBe('Runs campaigns')
        const entry = options[1]
        expect(entry.isDefaultProjectAssistant).toBe(true)
        expect(entry.assistant.description).toBe('From your default project')
        // The row activates the CURRENT project — choosing it means "answer here as the default
        // assistant", not "take me to the default project".
        expect(entry.projectId).toBe('p1')
        // The label must not leak back onto the shared store object.
        expect(defaultAssistant.description).toBe('AI Chief of Staff')
    })

    it('adds no default-project entry inside the default project itself', () => {
        const options = buildProjectAssistantOptions({
            project: project(DEFAULT_PROJECT_ID, 'Personal'),
            projectAssistants: [defaultAssistant, assistant('a9', 'Judy Job')],
            defaultProjectId: DEFAULT_PROJECT_ID,
            defaultAssistant,
        })

        expect(options.map(option => option.assistantId)).toEqual(['anna', 'a9'])
        expect(options.every(option => !option.isDefaultProjectAssistant)).toBe(true)
    })

    it('does not repeat the default assistant when it already belongs to the project', () => {
        const options = buildProjectAssistantOptions({
            project: project('p1', 'Marketing'),
            projectAssistants: [defaultAssistant],
            defaultProjectId: DEFAULT_PROJECT_ID,
            defaultAssistant,
        })

        expect(options).toHaveLength(1)
        expect(options[0].isDefaultProjectAssistant).toBe(false)
    })

    it('returns nothing for a project that is not loaded yet', () => {
        expect(buildProjectAssistantOptions({ project: null, defaultAssistant })).toEqual([])
        expect(buildProjectAssistantOptions()).toEqual([])
    })
})

describe('buildAllProjectsAssistantGroups', () => {
    // The reporting account's real shape: display names repeat across projects as separate
    // assistant documents, which is exactly why the popup groups instead of flattening.
    const projects = [
        project('p-alldone', 'Alldone Product'),
        project(DEFAULT_PROJECT_ID, 'Personal'),
        project('p-empty', 'No assistants here'),
        project('p-jtl', 'JTL'),
    ]
    const assistantsByProject = {
        'p-alldone': [assistant('a1', 'Marty Marketing'), assistant('a2', 'Derek Designer')],
        [DEFAULT_PROJECT_ID]: [defaultAssistant],
        'p-empty': [],
        'p-jtl': [assistant('a3', 'Marty Marketing')],
    }

    const groups = () =>
        buildAllProjectsAssistantGroups({
            projects,
            assistantsByProject,
            globalAssistants: [],
            defaultProjectId: DEFAULT_PROJECT_ID,
        })

    it('puts the default project first and drops projects with no assistants', () => {
        expect(groups().map(group => group.projectId)).toEqual([DEFAULT_PROJECT_ID, 'p-alldone', 'p-jtl'])
    })

    it('keeps same-named assistants from different projects apart', () => {
        const martys = flattenAssistantGroups(groups()).filter(
            option => option.assistant.displayName === 'Marty Marketing'
        )

        expect(martys).toHaveLength(2)
        expect(martys.map(option => option.projectId)).toEqual(['p-alldone', 'p-jtl'])
        // Distinct react keys, so the list cannot collapse two real choices into one row.
        expect(new Set(martys.map(option => option.key)).size).toBe(2)
    })

    it('never repeats the default-project entry under every project', () => {
        expect(flattenAssistantGroups(groups()).filter(option => option.isDefaultProjectAssistant)).toHaveLength(0)
        expect(flattenAssistantGroups(groups()).filter(option => option.assistantId === 'anna')).toHaveLength(1)
    })

    it('reports the project each option would activate', () => {
        const jtl = findAssistantOption(groups(), 'p-jtl', 'a3')
        expect(jtl.projectId).toBe('p-jtl')
        expect(jtl.projectName).toBe('JTL')
    })
})

describe('orderProjectsForAssistantSwitch', () => {
    it('leaves the caller’s order alone when the default project is not in the list', () => {
        const list = [project('a', 'A'), project('b', 'B')]
        expect(orderProjectsForAssistantSwitch(list, 'missing').map(p => p.id)).toEqual(['a', 'b'])
    })

    it('ignores unloaded entries', () => {
        expect(orderProjectsForAssistantSwitch([null, undefined, project('a', 'A')], 'a').map(p => p.id)).toEqual(['a'])
    })
})

describe('counting and toggling', () => {
    const options = buildProjectAssistantOptions({
        project: project('p1', 'Marketing'),
        projectAssistants: [assistant('a1', 'One'), assistant('a2', 'Two')],
        defaultProjectId: DEFAULT_PROJECT_ID,
        defaultAssistant,
    })
    const groups = buildSingleAssistantGroup(project('p1', 'Marketing'), options)

    it('counts every option across every group', () => {
        expect(countAssistantOptions(groups)).toBe(3)
        expect(countAssistantOptions([])).toBe(0)
    })

    it('toggles to the option that is not currently active', () => {
        expect(getToggleTargetOption(groups, 'p1', 'a1').assistantId).toBe('a2')
        expect(getToggleTargetOption(groups, 'p1', 'a2').assistantId).toBe('a1')
    })

    it('falls back to the first option when the active one is no longer in the list', () => {
        // A selection whose assistant was deleted must still leave a working button.
        expect(getToggleTargetOption(groups, 'p1', 'deleted-assistant').assistantId).toBe('a1')
    })

    it('treats the same assistant in another project as a different option', () => {
        const crossProject = [
            { key: 'p1:a1', assistantId: 'a1', projectId: 'p1', assistant: assistant('a1', 'One') },
            { key: 'p2:a1', assistantId: 'a1', projectId: 'p2', assistant: assistant('a1', 'One') },
        ]
        const target = getToggleTargetOption([{ projectId: 'x', options: crossProject }], 'p1', 'a1')
        expect(target.projectId).toBe('p2')
    })

    it('has nothing to toggle to with an empty list', () => {
        expect(getToggleTargetOption([], 'p1', 'a1')).toBeNull()
        expect(buildSingleAssistantGroup(project('p1', 'Marketing'), [])).toEqual([])
    })
})
