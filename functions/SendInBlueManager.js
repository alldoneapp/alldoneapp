'use strict'
const handlebars = require('handlebars')
const fs = require('fs')
const moment = require('moment')

const RichText = require('./Utils/RichText')
const firebaseConfig = require('./firebaseConfig.js')

const FC = require('./Utils/FeedConstants')

const SibApiV3Sdk = require('sib-api-v3-sdk')
const {
    generateEmailContent,
    sendEmailWithSendInBlue,
    getUserDocs,
    getProject,
} = require('./Emails/NewChatMessage/sendChatNoitifcationsHelper')
const { getUserData } = require('./Users/usersFirestore')
const { getEnvFunctions } = require('./envFunctionsHelper')
const defaultClient = SibApiV3Sdk.ApiClient.instance

// Configure API key authorization: api-key
const apiKey = defaultClient.authentications['api-key']
const { SIB_API_KEY } = getEnvFunctions()
apiKey.apiKey = SIB_API_KEY

// const SIB_API = new SibApiV3Sdk.AccountApi()
const SIB_API_TRANSACT = new SibApiV3Sdk.TransactionalEmailsApi()

const MAX_OBJECTS_TO_PROCESS = 5
const MAX_FEEDS_TO_PROCESS = 5

handlebars.registerHelper('inc', (value, options) => {
    return parseInt(value) + 1
})

handlebars.registerHelper('projectUrl', (appUrl, color, outline, options) => {
    color = color.indexOf('#') !== -1 ? color.substr(1) : color
    return `${appUrl}icons/project-colors/${outline === 'true' ? 'outline' : 'filled'}_${color.toUpperCase()}.png`
})

handlebars.registerHelper('ifCond', function (v1, operator, v2, options) {
    switch (operator) {
        case '==':
            return v1 == v2 ? options.fn(this) : options.inverse(this)
        case '===':
            return v1 === v2 ? options.fn(this) : options.inverse(this)
        case '!=':
            return v1 != v2 ? options.fn(this) : options.inverse(this)
        case '!==':
            return v1 !== v2 ? options.fn(this) : options.inverse(this)
        case '<':
            return v1 < v2 ? options.fn(this) : options.inverse(this)
        case '<=':
            return v1 <= v2 ? options.fn(this) : options.inverse(this)
        case '>':
            return v1 > v2 ? options.fn(this) : options.inverse(this)
        case '>=':
            return v1 >= v2 ? options.fn(this) : options.inverse(this)
        case '&&':
            return v1 && v2 ? options.fn(this) : options.inverse(this)
        case '||':
            return v1 || v2 ? options.fn(this) : options.inverse(this)
        default:
            return options.inverse(this)
    }
})

handlebars.registerHelper('richText', (text, size = RichText.SIZE_TITLE, options) => {
    const elements = RichText.parseRichText(text)
    let richText = ''

    for (let el of elements) {
        richText += RichText.buildTag(el, size)
    }

    return richText
})

const sendEmailInvitationToProject = async data => {
    const {
        userEmail,
        inviterName,
        inviterPhotoURL,
        projectName,
        projectColor,
        answerURL,
        projectDetailsURL,
        date,
    } = data

    const replacements = {
        tmplProjectName: projectName,
        tmplProjectColor: projectColor,
        tmplInviterPhotoURL: inviterPhotoURL,
        tmplInvitationText: `${inviterName} invited you to join the following project on Alldone.app`,
        tmplDate: date,
        tmplProjectUrl: projectDetailsURL,
        tmplAnswerUrl: answerURL,
        appUrl: firebaseConfig.app_url,
        appImpressum: `https://alldone.app/impressum`,
    }

    const html = readFileSync('./EmailTemplates/ProjectInvitation.html')
    const template = handlebars.compile(html)
    const htmlToSend = template(replacements)

    let sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail()
    sendSmtpEmail = {
        sender: { email: 'noreply@alldone.app', name: 'Alldone.app' },
        to: [{ email: userEmail }],
        subject: 'Alldone.app - Invitation to a project',
        htmlContent: htmlToSend,
        headers: { Connection: 'keep-alive' },
    }
    if (userEmail === 'alldoneapp@exdream.com') {
        return null
    }

    SIB_API_TRANSACT.sendTransacEmail(sendSmtpEmail).then(
        function (data) {
            console.log('API called successfully. Returned data: ' + data)
        },
        function (error) {
            console.log(JSON.stringify(error))
            console.log('ERROR:\n' + error)
        }
    )
}

const sendMonthlyPremiumGoldNotification = async data => {
    const { userEmail, userName, userPhotoURL, date } = data

    const replacements = {
        tmplUserPhotoURL: userPhotoURL,
        tmplNotificationText: `${userName}, you have received your monthly 1000 gold for the premium subscription.`,
        tmplDate: date,
        appUrl: firebaseConfig.app_url,
        appImpressum: `https://alldone.app/impressum`,
    }

    const html = readFileSync('./EmailTemplates/MonthlyPremiumGold.html')
    const template = handlebars.compile(html)
    const htmlToSend = template(replacements)

    let sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail()
    sendSmtpEmail = {
        sender: { email: 'noreply@alldone.app', name: 'Alldone.app' },
        to: [{ email: userEmail }],
        subject: 'Alldone.app - Received monthly premium gold',
        htmlContent: htmlToSend,
        headers: { Connection: 'keep-alive' },
    }
    if (userEmail === 'alldoneapp@exdream.com') {
        return null
    }

    SIB_API_TRANSACT.sendTransacEmail(sendSmtpEmail).then(
        function (data) {
            console.log('API called successfully. Returned data: ' + data)
        },
        function (error) {
            console.log(JSON.stringify(error))
            console.log('ERROR:\n' + error)
        }
    )
}

const sendMonthlyFreeGoldNotification = async data => {
    const { userEmail, userName, userPhotoURL, date } = data

    const replacements = {
        tmplUserPhotoURL: userPhotoURL,
        tmplNotificationText: `${userName}, you have received your monthly 100 gold.`,
        tmplDate: date,
        appUrl: firebaseConfig.app_url,
        appImpressum: `https://alldone.app/impressum`,
    }

    const html = readFileSync('./EmailTemplates/MonthlyGold.html')
    const template = handlebars.compile(html)
    const htmlToSend = template(replacements)

    let sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail()
    sendSmtpEmail = {
        sender: { email: 'noreply@alldone.app', name: 'Alldone.app' },
        to: [{ email: userEmail }],
        subject: 'Alldone.app - Received monthly gold',
        htmlContent: htmlToSend,
        headers: { Connection: 'keep-alive' },
    }
    if (userEmail === 'alldoneapp@exdream.com') {
        return null
    }

    SIB_API_TRANSACT.sendTransacEmail(sendSmtpEmail).then(
        function (data) {
            console.log('API called successfully. Returned data: ' + data)
        },
        function (error) {
            console.log(JSON.stringify(error))
            console.log('ERROR:\n' + error)
        }
    )
}

const getTemplateIdWhenSingUp = async (admin, user) => {
    const { singUpUrl } = user
    if (singUpUrl) {
        const projectId = singUpUrl.split('/')[2]
        if (projectId) {
            const project = (await admin.firestore().doc(`/projects/${projectId}`).get()).data()
            if (project && project.isTemplate) {
                return projectId
            }
        }
    }

    return ''
}

const sendEmailToNewSignUpUser = async (admin, user) => {
    const templateId = await getTemplateIdWhenSingUp(admin, user)
    const htmlToSend = templateId
        ? `<p><b>${user.displayName}</b> [${user.email}] has just signed up in <b>${firebaseConfig.app_name}.</b> TemplateId:<b>${templateId}</b></p>`
        : `<p><b>${user.displayName}</b> [${user.email}] has just signed up in <b>${firebaseConfig.app_name}</b></p>`

    let sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail()
    sendSmtpEmail = {
        sender: { email: 'noreply@alldone.app', name: 'Alldone.app' },
        to: [{ email: 'karsten@alldone.app' }],
        subject: 'Alldone.app - New sign up',
        htmlContent: htmlToSend,
        headers: { Connection: 'keep-alive' },
    }

    SIB_API_TRANSACT.sendTransacEmail(sendSmtpEmail).then(
        function (data) {
            console.log('API called successfully. Returned data: ' + data)
        },
        function (error) {
            console.log(JSON.stringify(error))
            console.log('ERROR:\n' + error)
        }
    )
}

const sendEmailToNewUserInGuide = async (guide, newUser, userToReceiveEmailId) => {
    const userToReceiveEmail = await getUserData(userToReceiveEmailId)

    const projectUrl = `projects/${guide.id}/user/${newUser.uid}/tasks/open`
    const htmlToSend = `
    <p>
        <b>${newUser.displayName}</b> [${newUser.email}] has joined a community: 
        <br />
        <b>Community name: </b>${guide.name}
        <br /> 
        <b>Community link: </b>${`${firebaseConfig.app_url}${projectUrl}`}
        <br /> 
        <b>App deploy: </b>${firebaseConfig.app_name}
    </p>
    `
    let sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail()
    sendSmtpEmail = {
        sender: { email: 'noreply@alldone.app', name: 'Alldone.app' },
        to: [{ email: userToReceiveEmail.email }],
        subject: 'Alldone.app - New user has joined a community',
        htmlContent: htmlToSend,
        headers: { Connection: 'keep-alive' },
    }

    SIB_API_TRANSACT.sendTransacEmail(sendSmtpEmail).then(
        function (data) {
            console.log('API called successfully. Returned data: ' + data)
        },
        function (error) {
            console.log(JSON.stringify(error))
            console.log('ERROR:\n' + error)
        }
    )
}

const sendNewUserJoinToGuideEmail = async (admin, guideId, newUserId, usersToReceiveEmailIds) => {
    const db = admin.firestore()

    let promises = []
    promises.push(getUserData(newUserId))
    promises.push(db.doc(`/projects/${guideId}`).get())
    const results = await Promise.all(promises)
    const newUser = results[0]

    const guide = results[1].data()
    guide.id = guideId

    promises = []
    usersToReceiveEmailIds.forEach(userToReceiveEmailId => {
        promises.push(sendEmailToNewUserInGuide(guide, newUser, userToReceiveEmailId))
    })
    await Promise.all(promises)
}

const sendEmailForNewTemplate = async template => {
    const creator = await getUserData(template.templateCreatorId)

    const htmlToSend = `
<p>
    <b>${creator.displayName}</b> [${creator.email}] has created a new template: 
    <br />
    <b>Template name: </b>${template.name}
    <br />    
    <b>App deploy: </b>${firebaseConfig.app_name}
</p>
`

    let sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail()
    sendSmtpEmail = {
        sender: { email: 'noreply@alldone.app', name: 'Alldone.app' },
        to: [{ email: 'karsten@alldone.app' }],
        subject: 'Alldone.app - New template',
        htmlContent: htmlToSend,
        headers: { Connection: 'keep-alive' },
    }

    SIB_API_TRANSACT.sendTransacEmail(sendSmtpEmail).then(
        function (data) {
            console.log('API called successfully. Returned data: ' + data)
        },
        function (error) {
            console.log(JSON.stringify(error))
            console.log('ERROR:\n' + error)
        }
    )
}

const sendEmailAfterProjectDuplication = data => {
    const { userEmail, projectName, projectColor, projectDetailsURL, date } = data

    const replacements = {
        tmplProjectName: projectName,
        tmplProjectColor: projectColor,
        tmplTextMessage: `The duplication of the following project has finished on Alldone.app`,
        tmplDate: date,
        tmplProjectUrl: `${firebaseConfig.app_url}${projectDetailsURL}`,
        appUrl: firebaseConfig.app_url,
        appImpressum: `https://alldone.app/impressum`,
    }

    const html = readFileSync('./EmailTemplates/ProjectDuplication.html')
    const template = handlebars.compile(html)
    const htmlToSend = template(replacements)

    let sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail()
    sendSmtpEmail = {
        sender: { email: 'noreply@alldone.app', name: 'Alldone.app' },
        to: [{ email: userEmail }],
        subject: 'Alldone.app - Duplication of project finished',
        htmlContent: htmlToSend,
        headers: { Connection: 'keep-alive' },
    }
    if (userEmail === 'alldoneapp@exdream.com') {
        return null
    }

    SIB_API_TRANSACT.sendTransacEmail(sendSmtpEmail).then(
        function (data) {
            console.log('API called successfully. Returned data: ' + data)
        },
        function (error) {
            console.log(JSON.stringify(error))
            console.log('ERROR:\n' + error)
        }
    )
}

const readFile = (path, callback) => {
    fs.readFile(path, { encoding: 'utf-8' }, (err, html) => {
        if (err) {
            throw err
        } else {
            callback(null, html)
        }
    })
}

const readFileSync = path => {
    return fs.readFileSync(path, { encoding: 'utf-8' })
}

const getFileNameByFeedType = feedObjectType => {
    switch (feedObjectType) {
        case FC.FEED_TASK_OBJECT_TYPE:
            return 'TaskFeed'
        case FC.FEED_PROJECT_OBJECT_TYPE:
            return 'ProjectFeed'
        case FC.FEED_USER_OBJECT_TYPE:
            return 'UserFeed'
        case FC.FEED_CONTACT_OBJECT_TYPE:
            return 'ContactFeed'
    }
}

const sendFeedNotifications = async admin => {
    const replacements = {
        feedBodyStyles: '',
        feedBody: '',
        appUrl: firebaseConfig.app_url,
        appImpressum: `https://alldone.app/impressum`,
    }

    const db = admin.firestore()

    const userList = (await db.collection('notifications').get()).docs
    console.log(`INFO: Found ${userList.length} users in notifications collection`)

    for (let userData of userList) {
        try {
            const deletePromises = []
            let countObjects = 0
            let countFeeds = 0

            replacements.feedBodyStyles = ''
            replacements.feedBody = ''

            const userId = userData.id
            const user = userData.data()
            console.log(`INFO: Processing user ${userId}, initial email:`, user.email || 'NOT SET')

            if (user.email == null || typeof user.email != 'string') {
                console.log(`INFO: User ${userId} has no email in notification doc, fetching from users collection`)
                const userDB = await getUserData(userId)
                user.email = userDB && userDB.email ? userDB.email : null
                console.log(`INFO: User ${userId} email after fetch:`, user.email || 'STILL NOT SET')
            }

            if (user && user.email) {
                console.log('INFO: Preparing notification email for user: ', user.email)
                const userTZFactor = user.timezone ? user.timezone : 0

                const objectList = (await db.collection(`notifications/${userId}/objects`).get()).docs
                console.log(`INFO: Found ${objectList.length} objects for user ${user.email}`)

                if (objectList.length === 0) {
                    console.log(`INFO: No notification objects for user ${user.email}, skipping email`)
                }

                let htmlToSend = ''
                let placedHeader = false

                for (let objectData of objectList) {
                    countObjects++
                    const objectId = objectData.id
                    const object = objectData.data()
                    console.log(
                        `INFO: Processing object ${objectId} (type: ${object.feedObjectType}) for user ${user.email}`
                    )
                    const fileName = getFileNameByFeedType(object.feedObjectType)
                    object.feedDate = moment(object.feedDate).add(userTZFactor, 'hours').format('DD.MM.YYYY HH:mm')

                    const feedList = (await db.collection(`notifications/${userId}/objects/${objectId}/feeds`).get())
                        .docs
                    console.log(`INFO: Found ${feedList.length} feeds in object ${objectId}`)

                    const cssFile = readFileSync(`./EmailTemplates/styles/${fileName}.css`)
                    replacements.feedBodyStyles += cssFile

                    const feedItemsHtml = readFileSync(`./EmailTemplates/FeedItems/${fileName}.html`)
                    const feedItemTemplate = handlebars.compile(feedItemsHtml)
                    let feedItemsBody = ''

                    for (let feedData of feedList) {
                        countFeeds++
                        const feed = {
                            ...feedData.data(),
                            appUrl: replacements.appUrl,
                            appImpressum: replacements.appImpressum,
                        }
                        feed.feedTime = moment(feed.feedTime).add(userTZFactor, 'hours').format('HH:mm')
                        feedItemsBody += feedItemTemplate(feed)

                        // Remove feed item from DB after send it
                        deletePromises.push(
                            db.doc(`notifications/${userId}/objects/${objectId}/feeds/${feedData.id}`).delete()
                        )

                        // stop processing feeds if reach the limit
                        if (countFeeds >= MAX_FEEDS_TO_PROCESS) {
                            break
                        }
                    }

                    const feedBodyHtml = readFileSync(`./EmailTemplates/${fileName}.html`)
                    const feedBodyTemplate = handlebars.compile(feedBodyHtml)
                    let feedBody = {
                        ...object,
                        feedItems: feedItemsBody,
                        appUrl: replacements.appUrl,
                        appImpressum: replacements.appImpressum,
                    }

                    if (!placedHeader) {
                        placedHeader = true
                        feedBody = {
                            ...feedBody,
                            messageHeader: true,
                        }
                    }

                    replacements.feedBody += feedBodyTemplate(feedBody)

                    const html = readFileSync('./EmailTemplates/BaseTemplate.html')
                    const template = handlebars.compile(html)
                    htmlToSend = template(replacements)

                    // Remove feed object from DB after send it
                    if (feedList.length <= MAX_FEEDS_TO_PROCESS) {
                        deletePromises.push(db.doc(`notifications/${userId}/objects/${objectId}`).delete())
                    }

                    // stop processing feeds if reach the limit
                    if (countObjects >= MAX_OBJECTS_TO_PROCESS) {
                        break
                    }
                }

                // Remove notifications from DB after send it
                if (objectList.length <= MAX_OBJECTS_TO_PROCESS) {
                    deletePromises.push(db.doc(`notifications/${userId}`).delete())
                }

                let sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail()
                sendSmtpEmail = {
                    sender: { email: 'noreply@alldone.app', name: 'Alldone.app' },
                    to: [{ email: user.email }],
                    subject: 'Alldone.app - Updates notification',
                    htmlContent: htmlToSend,
                    headers: { Connection: 'keep-alive' },
                }

                if (countFeeds === 0) {
                    console.log(
                        `INFO: User ${user.email} has ${countObjects} objects but 0 feeds total, skipping email`
                    )
                } else if (user.email !== 'alldoneapp@exdream.com') {
                    console.log(
                        `INFO: Sending email to ${user.email} with ${countFeeds} feeds from ${countObjects} objects`
                    )
                    SIB_API_TRANSACT.sendTransacEmail(sendSmtpEmail).then(
                        function (data) {
                            console.log('API called successfully. Returned data:\n')
                            console.log(data)
                            Promise.all(deletePromises)
                        },
                        function (error) {
                            console.log('ERROR: SendInBlue API error:\n')
                            console.log(error)
                        }
                    )
                } else {
                    console.log('INFO: Skipping email to test account: alldoneapp@exdream.com')
                }
            } else {
                console.log(
                    `INFO: Skipping user ${userId} - no valid email (user exists:`,
                    !!user,
                    'email:',
                    user ? user.email : 'N/A',
                    ')'
                )
            }
        } catch (error) {
            console.log('ERROR processing user in sendFeedNotifications:\n')
            console.log(error)
            continue
        }
    }
    console.log('INFO: Finished processing all users in notifications collection')
}

const sendChatNotificationToUsers = async (
    admin,
    projectId,
    userIds,
    objectType,
    objectId,
    objectName,
    messageTimestamp
) => {
    const promises = []
    promises.push(getProject(admin, projectId))
    promises.push(getUserDocs(admin, userIds))
    const [project, userDocs] = await Promise.all(promises)

    if (!project) return
    const { color: projectColor, name: projectName } = project

    for (let userData of userDocs) {
        try {
            const user = userData.data()
            if (!user) continue

            sendChatNotificationToUser(
                projectId,
                projectName,
                projectColor,
                objectType,
                objectId,
                objectName,
                messageTimestamp,
                user
            )
        } catch (error) {
            console.log('ERROR:\n')
            console.log(error)
            continue
        }
    }
}

const sendChatNotificationToUser = (
    projectId,
    projectName,
    projectColor,
    objectType,
    objectId,
    objectName,
    messageTimestamp,
    user
) => {
    const { receiveEmails, timezone, email: userEmail, notificationEmail } = user
    const email = notificationEmail ? notificationEmail : userEmail

    if (receiveEmails && email && email !== 'alldoneapp@exdream.com') {
        const htmlContent = generateEmailContent(
            handlebars,
            timezone,
            messageTimestamp,
            projectName,
            projectId,
            objectType,
            projectColor,
            objectId,
            objectName
        )

        sendEmailWithSendInBlue(SibApiV3Sdk, SIB_API_TRANSACT, email, htmlContent)
    }
}

const sendChatNotifications = async admin => {
    const notificationsDocs = (await admin.firestore().collection(`emailNotifications`).get()).docs

    const promises = []

    notificationsDocs.forEach(doc => {
        const { userIds, projectId, objectType, objectId, objectName, messageTimestamp } = doc.data()
        if (userIds.length > 0) {
            promises.push(
                sendChatNotificationToUsers(
                    admin,
                    projectId,
                    userIds,
                    objectType,
                    objectId,
                    objectName,
                    messageTimestamp
                )
            )
        }
        promises.push(admin.firestore().doc(`emailNotifications/${doc.id}`).delete())
    })

    await Promise.all(promises)
}

module.exports = {
    sendEmailInvitationToProject,
    sendMonthlyPremiumGoldNotification,
    sendFeedNotifications,
    sendChatNotifications,
    sendEmailToNewSignUpUser,
    sendEmailAfterProjectDuplication,
    sendEmailForNewTemplate,
    sendNewUserJoinToGuideEmail,
    getTemplateIdWhenSingUp,
    sendMonthlyFreeGoldNotification,
}
