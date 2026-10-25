import fs from 'fs'
import path from 'path'
import { parse } from '@babel/parser'

// Run the actual public save functions with a deferred Firestore transport.
// This pins the previously discarded commit/update promises without loading
// the entire app shell and its realtime listeners.
const loadFunction = (file, name, dependencies) => {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8')
    const declaration = parse(source, { sourceType: 'module' }).program.body.find(
        node => node.declaration?.id?.name === name
    )?.declaration
    if (!declaration) throw new Error(`Missing ${name}`)
    return new Function(
        ...Object.keys(dependencies),
        `${source.slice(declaration.start, declaration.end)}; return ${name}`
    )(...Object.values(dependencies))
}

const cases = [
    ['Tasks/tasksFirestore.js', 'setTaskDescription', ['project', 'task', 'new', { id: 'task' }, 'old']],
    ['firestore.js', 'setProjectDescription', ['project', 'new', { id: 'project' }, 'old']],
    ['Goals/goalsFirestore.js', 'setGoalDescription', ['project', 'goal', 'new', { id: 'goal' }, 'old']],
    ['Skills/skillsFirestore.js', 'updateSkillDescription', ['project', { id: 'skill', description: 'old' }, 'new']],
    [
        'Assistants/assistantsFirestore.js',
        'updateAssistantDescription',
        ['project', 'new', { uid: 'assistant', description: 'old' }],
    ],
]

const setup = (file, name) => {
    let resolve, reject
    const write = new Promise((res, rej) => {
        resolve = res
        reject = rej
    })
    const commit = jest.fn(() => write)
    const dependencies = {
        BatchWrapper: class {
            commit = commit
            update() {}
        },
        getDb: () => ({}),
        db: { doc: () => ({}) },
        store: { getState: () => ({ loggedUser: { uid: 'user' } }) },
        createGenericTaskWhenMentionInTitleEdition: jest.fn(),
        queueUndoAction: jest.fn(),
        buildTaskUpdateOperation: jest.fn(),
        updateTaskData: jest.fn(),
        getMentionedUsersIdsWhenEditText: () => [],
        insertFollowersUserToFeedChain: jest.fn(),
        createTaskDescriptionChangedFeed: jest.fn(),
        processFollowersWhenEditTexts: jest.fn(),
        createProjectDescriptionChangedFeed: jest.fn(),
        tryAddFollower: jest.fn(),
        updateGoalData: jest.fn(() => write),
        updateGoalDescriptionFeedsChain: jest.fn(),
        updateSkillData: jest.fn(() => write),
        skillDescriptionChangedUpdatesChain: jest.fn(),
        updateAssistantData: jest.fn(() => write),
        isGlobalAssistant: () => false,
        assistantDescriptionChangedUpdatesChain: jest.fn(),
        GENERIC_TASK_TYPE: 'task',
        GENERIC_GOAL_TYPE: 'goal',
        GENERIC_SKILL_TYPE: 'skill',
        FOLLOWER_TASKS_TYPE: 'task',
        FOLLOWER_PROJECTS_TYPE: 'project',
    }
    return { run: loadFunction(file, name, dependencies), resolve, reject }
}

it.each(cases)('%s %s waits for the write acknowledgement', async (file, name, args) => {
    const { run, resolve } = setup(file, name)
    let settled = false
    const saving = run(...args).then(() => {
        settled = true
    })
    for (let i = 0; i < 8; i++) await Promise.resolve()
    expect(settled).toBe(false)
    resolve()
    await saving
    expect(settled).toBe(true)
})

it.each(cases)('%s %s propagates write failures to autosave', async (file, name, args) => {
    const { run, reject } = setup(file, name)
    const saving = run(...args)
    const expectation = expect(saving).rejects.toThrow('permission-denied')
    for (let i = 0; i < 8; i++) await Promise.resolve()
    reject(new Error('permission-denied'))
    await expectation
})

it('the project backend bridge forwards failures instead of resolving early', async () => {
    const source = fs.readFileSync(path.join(__dirname, '../BackendBridge.js'), 'utf8')
    const declaration = parse(source, { sourceType: 'module' }).program.body.find(
        node => node.type === 'ExportDefaultDeclaration'
    ).declaration
    const backend = { setProjectDescription: jest.fn(() => Promise.reject(new Error('failed'))) }
    const Bridge = new Function('bridge', `return ${source.slice(declaration.start, declaration.end)}`)(backend)
    await expect(Bridge.setProjectDescription('project', 'new', {}, 'old')).rejects.toThrow('failed')
})
