import moment from 'moment'

const date = moment()

const dummyUserId = 'UUKU61Jc7ET8zE5ncN8F61HE19y1'
export const MockTaskListByDate = [
    {
        id: '-Lz-asdfghjkl098765432119',
        done: false,
        name: 'My new task',
        userId: dummyUserId,
        created: date.valueOf(),
        dueDate: date.valueOf(),
        completed: date.valueOf(),
        hasStar: false,
        creatorId: dummyUserId,
        isPrivate: false,
        parentId: null,
        subtaskIds: [],
    },
    {
        id: '-Lz-asdfghjkl0987wef5dben',
        done: true,
        name: 'My new task 1',
        userId: dummyUserId,
        created: date.valueOf(),
        dueDate: date.valueOf(),
        completed: date.valueOf(),
        hasStar: false,
        creatorId: dummyUserId,
        isPrivate: false,
        parentId: null,
        subtaskIds: [],
    },
    {
        id: '-Lz-asdfghjkqwevr432f42esd',
        done: false,
        name: 'My new task 2',
        userId: dummyUserId,
        created: date.valueOf(),
        dueDate: date.valueOf(),
        completed: date.valueOf(),
        hasStar: false,
        creatorId: dummyUserId,
        isPrivate: false,
        parentId: null,
        subtaskIds: [],
    },
]

let projectTasks = [[], []]
projectTasks[0].push(MockTaskListByDate[0])
projectTasks[0].push(MockTaskListByDate[1])
projectTasks[1].push(MockTaskListByDate[2])

export const MockProjectTasks = projectTasks
