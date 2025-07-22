'use strict'
const SibApiV3Sdk = require('sib-api-v3-sdk')
const fs = require('fs')
const handlebars = require('handlebars')
const moment = require('moment')

const firebaseConfig = require('../../firebaseConfig')

const SIB_API_TRANSACT = new SibApiV3Sdk.TransactionalEmailsApi()
let sendSmtpEmail = new SibApiV3Sdk.SendSmtpEmail()

const sendEmail = (buffer, url, name, email, startDate, endDate, invoiceNo, isEditingUsers, paidUsersAmount) => {
    let htmlContent = fs.readFileSync('./EmailTemplates/InvoiceBody.html', 'utf8')
    const template = handlebars.compile(htmlContent)
    const replacements = {
        name: name.split(' ')[0],
        startDate,
        endDate,
        onDate: moment().format('DD.MM.YYYY HH:mm'),
        currentYear: moment().year(),
        appUrl: firebaseConfig.app_url,
        appImpressum: `https://alldone.app/impressum`,
        pdfUlr: url,
        paidUsersAmount,
        isEditingUsers,
        usersWord: paidUsersAmount === 1 ? 'user' : 'users',
    }
    const htmlToSend = template(replacements)

    sendSmtpEmail = {
        sender: { email: 'noreply@alldone.app', name: 'Alldone.app' },
        to: [{ email: email }],
        bcc: [{ email: 'karsten@alldone.app' }],
        subject: 'Alldone.app - Invoice',
        headers: { Connection: 'keep-alive' },
        htmlContent: htmlToSend,
        attachment: [
            {
                name: `${invoiceNo}.pdf`,
                content: buffer.toString('base64'),
            },
        ],
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
module.exports = { sendEmail }
