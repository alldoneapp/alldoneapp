const admin = require('firebase-admin')
const { generateTask } = require('../GoogleCalendarTasks/calendarTasks')

const addUnreadMailsTask = async (projectId, uid, currentDate, unreadMails, email) => {
    const date = new Date(currentDate)
    const day = date.getDate()
    const month = date.getMonth()
    const year = date.getFullYear()
    const min = new Date(year, month, day)
    const max = new Date(year, month, day, 23, 59, 59)

    Promise.all([
        admin
            .firestore()
            .collection(`items/${projectId}/tasks`)
            .where('isForEmail', '==', true)
            .where('done', '==', false)
            .where('userId', '==', uid)
            .get(),
        admin
            .firestore()
            .collection(`items/${projectId}/tasks`)
            .where('isForEmail', '==', true)
            .where('dueDate', '>=', min.valueOf())
            .where('dueDate', '<=', max.valueOf())
            .where('userId', '==', uid)
            .get(),
    ]).then(snap => {
        const [openEmailTasks, todayEmailTasks] = snap
        if (openEmailTasks.empty && todayEmailTasks.empty) {
            const taskId = `emailTask-${uid}-${year}-${month}-${day}`
            admin
                .firestore()
                .doc(`items/${projectId}/tasks/${taskId}`)
                .set(
                    generateTask(
                        {
                            isForEmail: true,
                            gmailData: { email, unreadMails },
                            name: 'Emails in inbox',
                            extendedName: 'Emails in inbox',
                            description: '',
                            sortIndex: Date.now(),
                        },
                        uid
                    )
                )
        } else if (!openEmailTasks.empty) {
            const tasksIds = [...new Set([...snap[0].docs.map(i => i.id), ...snap[1].docs.map(i => i.id)])]
            tasksIds.forEach(taskId => {
                admin.firestore().doc(`items/${projectId}/tasks/${taskId}`).update({
                    gmailData: { email, unreadMails },
                    dueDate: Date.now(),
                })
            })
        }
    })
}

module.exports = { addUnreadMailsTask }
