
const COPY_PROJECT_TASKS = 'PROJECT_TASKS'
const COPY_PROJECT_GOALS = 'PROJECT_GOALS'
const COPY_PROJECT_NOTES = 'PROJECT_NOTES'
const COPY_PROJECT_CONTACTS = 'PROJECT_CONTACTS'
const COPY_PROJECT_WORKSTREAMS = 'PROJECT_WORKSTREAMS'
const FEED_PUBLIC_FOR_ALL = 0

const promiseAllAndCatch = async (promises, type = '') => {
    return await Promise.all(
        promises.map(p =>
            p.catch(e => {
                // Handle error for each Promise operation
                // it not fails All if one of them fails
                console.log(`>> Error setting the duplicated ${type} objects: \n ${e}`)
            })
        )
    )
}

module.exports = {
    promiseAllAndCatch,
    COPY_PROJECT_TASKS,
    COPY_PROJECT_GOALS,
    COPY_PROJECT_NOTES,
    COPY_PROJECT_CONTACTS,
    COPY_PROJECT_WORKSTREAMS,
    FEED_PUBLIC_FOR_ALL,
}
