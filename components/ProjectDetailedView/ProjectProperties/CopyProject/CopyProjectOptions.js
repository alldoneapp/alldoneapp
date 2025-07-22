export const COPY_PROJECT_TASKS = 'PROJECT_TASKS'
export const COPY_PROJECT_GOALS = 'PROJECT_GOALS'
export const COPY_PROJECT_NOTES = 'PROJECT_NOTES'
export const COPY_PROJECT_CONTACTS = 'PROJECT_CONTACTS'

export const COPY_PROJECT_OPTIONS = [
    {
        name: 'Tasks',
        description: 'Copy Tasks description',
        icon: 'check-square',
        value: COPY_PROJECT_TASKS,
    },
    {
        name: 'Goals',
        description: 'Copy Goals description',
        icon: 'target',
        value: COPY_PROJECT_GOALS,
    },
    {
        name: 'Notes',
        description: 'Copy Notes description',
        icon: 'file',
        value: COPY_PROJECT_NOTES,
    },
    {
        name: 'Contacts',
        description: 'Copy Contacts description',
        icon: 'users',
        value: COPY_PROJECT_CONTACTS,
    },
]
