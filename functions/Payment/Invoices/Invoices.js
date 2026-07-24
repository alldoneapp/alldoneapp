'use strict'
const fs = require('fs')
const pdf = require('html-pdf')
const moment = require('moment')
const { v4: uuidv4 } = require('uuid')
const handlebars = require('handlebars')
const admin = require('firebase-admin')
const { defineString } = require('firebase-functions/params')

const { sendEmail } = require('./SendInvoiceEmail')
const { getDaysLeftUntilNextPaymentPercent } = require('../SubscriptionsHelper')

const netPrice = 4.2
const vatPercent = 0.8

const options = {
    format: 'Letter',
    footer: { height: '15mm' },
    childProcessOptions: {
        env: {
            OPENSSL_CONF: '/dev/null',
        },
    },
}

const generatePremiumInvoiceNumber = async () => {
    await admin
        .firestore()
        .doc('invoiceNumbers/premiumInvoiceNumber')
        .set({ number: admin.firestore.FieldValue.increment(1) }, { merge: true })
    const { number } = (await admin.firestore().doc('invoiceNumbers/premiumInvoiceNumber').get()).data()

    const numberLength = number.toString().length
    const maxZeros = 4
    const amountZeros = numberLength >= maxZeros ? 0 : maxZeros - numberLength
    const invoiceNumber = `${moment().year()} - ${'0'.repeat(amountZeros)}${number}`

    return invoiceNumber
}

const createPdf = (
    paidUsersAmount,
    uid,
    amountValue,
    name,
    email,
    companyData,
    isEditingUsers,
    nextPaymentDate,
    res
) => {
    let templateHtml = fs.readFileSync('./Payment/Invoices/invoice.html', 'utf8')
    const bucket = admin.storage().bucket()
    const date = moment()
    let streetAndNumber = ''
    let line2 = ''
    let line3 = ''

    const { addressLine1, addressLine2, postalCode, city, country } = companyData
    if (addressLine1 || addressLine2 || postalCode || city || country) {
        streetAndNumber = `${addressLine1}${addressLine2 ? ', ' + addressLine2 : ''}`
        line2 = `${postalCode} ${city}`
        line3 = country
    }

    const daysLeftUntilNextPaymentPercent = isEditingUsers ? getDaysLeftUntilNextPaymentPercent(nextPaymentDate) : 1

    generatePremiumInvoiceNumber().then(async invoiceNo => {
        const alldoneCompanyName = defineString('COMPANY_NAME').value()
        const alldoneCompanyAddress = defineString('COMPANY_ADDRESS').value()
        const alldoneCompanyPostalCode = defineString('COMPANY_POSTAL_CODE').value()
        const alldoneCompanyCity = defineString('COMPANY_CITY').value()
        const alldoneCompanyEmail = defineString('COMPANY_EMAIL').value()
        const alldoneCompanyCommercialRegisterNumber = defineString('COMPANY_COMMERCIAL_REGISTER_NUMBER').value()
        const alldoneCompanyTaxNumber = defineString('COMPANY_TAX_NUMBER').value()
        const alldoneCompanyVatId = defineString('COMPANY_VAT_ID').value()
        const alldoneCompanyOwner = defineString('COMPANY_OWNER').value()
        const alldoneCompanyOwnerPosition = defineString('COMPANY_OWNER_POSITION').value()

        const vatToApply = 0.19
        const totalPrice = netPrice * paidUsersAmount * daysLeftUntilNextPaymentPercent
        const vatPrice = vatPercent * paidUsersAmount * daysLeftUntilNextPaymentPercent

        const template = handlebars.compile(templateHtml)
        const replacements = {
            alldoneCompanyName,
            alldoneCompanyAddress,
            alldoneCompanyPostalCode,
            alldoneCompanyCity,
            alldoneCompanyEmail,
            alldoneCompanyCommercialRegisterNumber,
            alldoneCompanyTaxNumber,
            alldoneCompanyVatId,
            alldoneCompanyOwner,
            alldoneCompanyOwnerPosition,
            name: companyData.name ? companyData.name : name,
            line1: streetAndNumber,
            line2,
            line3,
            today: date.format('DD.MM.YYYY'),
            invoiceNo: invoiceNo,
            startDate: date.format('DD.MM.YYYY'),
            endDate: isEditingUsers
                ? moment(nextPaymentDate, 'YYYY-MM-DD').format('DD.MM.YYYY')
                : date.add(1, 'month').format('DD.MM.YYYY'),
            vatToApply: Math.floor(vatToApply * 100),
            users: paidUsersAmount,
            netPrice: (netPrice * daysLeftUntilNextPaymentPercent).toFixed(2),
            totalPrice: totalPrice.toFixed(2),
            vat: vatPrice.toFixed(2),
            totalInvoice: amountValue,
        }
        const htmlToSend = template(replacements)
        await pdf.create(htmlToSend, options).toBuffer(function (err, buffer) {
            if (err) return console.log(err)
            const file = bucket.file(`Invoice/${uid}/${invoiceNo}.pdf`)
            file.save(
                buffer,
                {
                    metadata: {
                        contentType: 'application/pdf',
                        metadata: {
                            firebaseStorageDownloadTokens: uuidv4(),
                        },
                    },
                },
                error => {
                    if (error) {
                        console.log('error')
                    }
                }
            )
            file.getSignedUrl({ action: 'read', expires: '03-17-2027' }, function (err, url) {
                sendEmail(
                    buffer,
                    url,
                    name,
                    email,
                    replacements.startDate,
                    replacements.endDate,
                    invoiceNo,
                    isEditingUsers,
                    paidUsersAmount
                )
            })
            res.status(200).end()
        })
    })
}

module.exports = { createPdf }
