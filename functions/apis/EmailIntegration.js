const moment = require('moment-timezone')
const admin = require('firebase-admin')
const { generateTask } = require('../GoogleCalendarTasks/calendarTasks')

const addUnreadMailsTask = async (projectId, uid, currentDate, unreadMails, email, timezone) => {
    // Handle both string and numeric timezones (migrated from serverSideCalendarSync logic)
    let date
    if (typeof timezone === 'string') {
        date = moment(currentDate).tz(timezone)
    } else {
        let timezoneOffset = 0
        if (typeof timezone === 'number') {
            // Range checks for valid hour offsets (typically -12 to +14) vs minutes
            if (Math.abs(timezone) <= 16) {
                timezoneOffset = timezone * 60
            } else {
                timezoneOffset = timezone
            }
        }
        date = moment(currentDate).utcOffset(timezoneOffset)
    }

    const day = date.date()
    const month = date.month()
    const year = date.year()

    // We want the start/end of the day in the USER'S timezone
    const min = date.clone().startOf('day').valueOf()
    const max = date.clone().endOf('day').valueOf()

    console.log(`[addUnreadMailsTask] projectId: ${projectId}, uid: ${uid}`)
    console.log(`[addUnreadMailsTask] input timezone: ${JSON.stringify(timezone)}`)
    console.log(`[addUnreadMailsTask] calculated date (User TZ): ${date.format()}`)
    console.log(`[addUnreadMailsTask] min: ${min} (${moment(min).format()}), max: ${max} (${moment(max).format()})`)

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
