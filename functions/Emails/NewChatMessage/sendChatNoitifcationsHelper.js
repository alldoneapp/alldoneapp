const fs = require('fs')
const moment = require('moment')

const firebaseConfig = require('../../firebaseConfig.js')

const readFileSync = path => {
    return fs.readFileSync(path, { encoding: 'utf-8' })
}

function generateEmailContent(
    handlebars,
    timezone,
    messageTimestamp,
    projectName,
    projectId,
    objectType,
    projectColor,
    objectId,
    objectName
) {
    const userTZFactor = timezone ? timezone : 0

    const messageHtml = readFileSync(`./Emails/NewChatMessage/MessageData.html`)
    const messageTemplate = handlebars.compile(messageHtml)
    const messageSection = messageTemplate({
        messageTime: moment(messageTimestamp).add(userTZFactor, 'hours').format('HH:mm'),
    })

    const bodyHtml = readFileSync(`./Emails/NewChatMessage/Content.html`)
    const bodyTemplate = handlebars.compile(bodyHtml)
    const bodySection = bodyTemplate({
        appUrl: firebaseConfig.app_url,
        projectName,
        projectColor,
        objectName,
        chatLink: `projects/${projectId}/${objectType}/${objectId}/chat`,
        messageSection: messageSection,
        messageDate: moment(messageTimestamp).add(userTZFactor, 'hours').format('DD.MM.YYYY HH:mm'),
    })

    const baseHtml = readFileSync('./Emails/NewChatMessage/BaseTemplate.html')
    const baseTemplate = handlebars.compile(baseHtml)
    const baseSection = baseTemplate({
        appUrl: firebaseConfig.app_url,
        appImpressum: `https://alldone.app/impressum`,
        bodySection: bodySection,
    })

    return baseSection
}

async function sendEmailWithEmailManager(mailTransport, email, htmlContent) {
    const mailOptions = {
        from: 'Alldone.app <noreply@alldone.app>',
        to: email,
        subject: 'Alldone.app - New message',
        html: htmlContent,
    }

    await mailTransport.sendMail(mailOptions, (err, info) => {
        if (err) {
            console.log('ERROR:\n' + err)
        }
    })
}

function sendEmailWithSendInBlue(SibApiV3Sdk, SIB_API_TRANSACT, email, htmlContent) {
    let sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail()
    sendSmtpEmail = {
        sender: { email: 'noreply@alldone.app', name: 'Alldone.app' },
        to: [{ email }],
        subject: 'Alldone.app - New message',
        htmlContent,
        headers: { Connection: 'keep-alive' },
    }

    SIB_API_TRANSACT.sendTransacEmail(sendSmtpEmail).then(
        function (data) {
            console.log('API called successfully. Returned data:\n')
            console.log(data)
        },
        function (error) {
            console.log('ERROR:\n')
            console.log(error)
        }
    )
}

async function getUserDocs(admin, userIds) {
    const promises = []
    userIds.forEach(uid => {
        promises.push(admin.firestore().doc(`users/${uid}`).get())
    })
    return await Promise.all(promises)
}

async function getProject(admin, projectId) {
    return (await admin.firestore().doc(`projects/${projectId}`).get()).data()
}

module.exports = { generateEmailContent, sendEmailWithSendInBlue, sendEmailWithEmailManager, getUserDocs, getProject }
