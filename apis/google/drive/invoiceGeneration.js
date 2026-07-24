import moment from 'moment'

import store from '../../../redux/store'
import { translate } from '../../../i18n/TranslationService'
import ProjectHelper from '../../../components/SettingsView/ProjectsSettings/ProjectHelper'

async function copyAndUpdateGoogleDoc(documentId, updates) {
    await gapi.client.docs.documents.batchUpdate({
        documentId: documentId,
        requests: updates,
    })
}

function getContentRequests(logoUrl) {
    const topText = `{{logo}}{{fromName}}{{fromAddress1}}{{fromAddress2}}{{fromPostalCode}}{{fromCity}}{{fromCountry}}\n\n{{invoice}}\n\n{{date}}\n\n{{toText}}:\n{{toName}}{{toAddress1}}{{toAddress2}}{{toPostalCode}}{{toCity}}{{toCountry}}\n{{invoiceNumberText}} {{invoiceNumber}}\n\n{{invoiceDescription}}\n\n{{usersData}}{{totalSumText}} {{sum}} {{currency}}\n{{vatText}}{{TotalInvoiceSumText}} {{totalSum}} {{currency}}\n\n{{pleasePayText}}\n\n{{thankYouText}}\n\n\n{{userName}}\n{{userRole}} {{userCompany}}{{signatureText}}`
    const requestsStart = [
        {
            updateTextStyle: {
                textStyle: {
                    weightedFontFamily: {
                        fontFamily: 'Roboto',
                    },
                },
                fields: 'weightedFontFamily',
                range: {
                    startIndex: 1,
                    endIndex: 2,
                },
            },
        },
        {
            insertText: {
                text: topText,
                location: {
                    index: 1,
                },
            },
        },
    ]
    const requestsLogo = [
        {
            insertInlineImage: {
                uri: logoUrl,
                location: {
                    index: 1, // Modified
                },
                objectSize: {
                    height: {
                        magnitude: 550,
                        unit: 'PT',
                    },
                    width: {
                        magnitude: 117,
                        unit: 'PT',
                    },
                },
            },
        },
    ]
    const requestsEnd = [
        {
            updateParagraphStyle: {
                range: {
                    startIndex: 1,
                    endIndex: 66,
                },
                paragraphStyle: {
                    alignment: 'END',
                },
                fields: 'alignment',
            },
        },
        {
            updateTextStyle: {
                textStyle: {
                    bold: true,
                },
                fields: 'bold',
                range: {
                    startIndex: 96,
                    endIndex: 109,
                },
            },
        },
        {
            updateParagraphStyle: {
                range: {
                    startIndex: 102,
                    endIndex: 109,
                },
                paragraphStyle: {
                    alignment: 'CENTER',
                },
                fields: 'alignment',
            },
        },
        {
            updateParagraphStyle: {
                range: {
                    startIndex: 116,
                    endIndex: 119,
                },
                paragraphStyle: {
                    alignment: 'END',
                },
                fields: 'alignment',
            },
        },
        {
            updateTextStyle: {
                textStyle: {
                    bold: true,
                },
                fields: 'bold',
                range: {
                    startIndex: 304 + 30,
                    endIndex: 353 + 30,
                },
            },
        },
    ]
    const requests = logoUrl ? [...requestsStart, ...requestsLogo, ...requestsEnd] : [...requestsStart, ...requestsEnd]
    return requests
}

function getFooterRequests(footerId) {
    const footerText = `{{footer}}`
    return [
        {
            insertText: {
                location: {
                    segmentId: footerId,
                    index: 0,
                },
                text: footerText,
            },
        },
        {
            updateTextStyle: {
                textStyle: {
                    weightedFontFamily: {
                        fontFamily: 'Roboto',
                    },
                    fontSize: {
                        magnitude: 9,
                        unit: 'PT',
                    },
                    foregroundColor: {
                        color: {
                            rgbColor: {
                                blue: 0.6,
                                green: 0.6,
                                red: 0.6,
                            },
                        },
                    },
                },
                fields: 'foregroundColor,weightedFontFamily,fontSize',
                range: {
                    segmentId: footerId,
                    startIndex: 0,
                    endIndex: 5,
                },
            },
        },
        {
            updateParagraphStyle: {
                range: {
                    segmentId: footerId,
                    startIndex: 0,
                    endIndex: 5,
                },
                paragraphStyle: {
                    alignment: 'CENTER',
                },
                fields: 'alignment',
            },
        },
    ]
}

function projectInvoiceReplacements(
    projectId,
    hourlyRatesData,
    fromData,
    toData,
    timestamps,
    invoiceNumber,
    usersDataText,
    totalSum,
    vatValue
) {
    const { loggedUser } = store.getState()
    const userRole = ProjectHelper.getUserRoleInProject(projectId, loggedUser.uid, loggedUser.role)
    const userCompany = ProjectHelper.getUserCompanyInProject(projectId, loggedUser.uid, loggedUser.company)

    const { currency } = hourlyRatesData
    const {
        name: fromName,
        addressLine1: fromAddressLine1,
        addressLine2: fromAddressLine2,
        postalCode: fromPostalCode,
        city: fromCity,
        country: fromCountry,
        vat: fromVat,
        logo: fromLogoUrl,
    } = fromData
    const {
        name: toName,
        addressLine1: toAddressLine1,
        addressLine2: toAddressLine2,
        postalCode: toPostalCode,
        city: toCity,
        country: toCountry,
    } = toData
    const { startDate, endDate } = timestamps
    const today = moment().format('DD.MM.YYYY')

    const vatText = fromVat ? `VAT (${fromVat}%): ${vatValue.toFixed(2)} ${currency}\n` : ''

    const footerText = getFooterText(fromData)

    const replacementsData = [
        ['{{logo}}', fromLogoUrl ? `\n` : ''],
        ['{{fromName}}', fromName && fromName.trim() ? `${fromName}\n` : ''],
        ['{{fromAddress1}}', fromAddressLine1 && fromAddressLine1.trim() ? `${fromAddressLine1}\n` : ''],
        ['{{fromAddress2}}', fromAddressLine2 && fromAddressLine2.trim() ? `${fromAddressLine2}\n` : ''],
        [
            '{{fromPostalCode}}',
            fromPostalCode && fromPostalCode.trim()
                ? `${fromPostalCode}${fromCity && fromCity.trim() ? ' ' : '\n'}`
                : '',
        ],
        ['{{fromCity}}', fromCity && fromCity.trim() ? `${fromCity}\n` : ''],
        ['{{fromCountry}}', fromCountry && fromCountry.trim() ? `${fromCountry}\n` : ''],
        ['{{toName}}', toName && toName.trim() ? `${toName}\n` : ''],
        ['{{toAddress1}}', toAddressLine1 && toAddressLine1.trim() ? `${toAddressLine1}\n` : ''],
        ['{{toAddress2}}', toAddressLine2 && toAddressLine2.trim() ? `${toAddressLine2}\n` : ''],
        [
            '{{toPostalCode}}',
            toPostalCode && toPostalCode.trim() ? `${toPostalCode}${toCity && toCity.trim() ? ' ' : '\n'}` : '',
        ],
        ['{{toCity}}', toCity && toCity.trim() ? `${toCity}\n` : ''],
        ['{{toCountry}}', toCountry && toCountry.trim() ? `${toCountry}\n` : ''],
        ['{{date}}', today],
        ['{{invoiceNumber}}', invoiceNumber],
        ['{{usersData}}', usersDataText],
        ['{{startDate}}', startDate],
        ['{{endDate}}', endDate],
        ['{{currency}}', currency],
        ['{{sum}}', `${totalSum.toFixed(2)}`],
        ['{{vatText}}', vatText],
        ['{{totalSum}}', `${(totalSum + vatValue).toFixed(2)}`],
        ['{{toText}}', translate('To')],
        ['{{invoice}}', translate('INVOICE')],
        ['{{invoiceNumberText}}', translate('Invoice Number')],
        ['{{invoiceDescription}}', translate('Invoice description', { startDate, endDate })],
        ['{{totalSumText}}', translate('Total Sum')],
        ['{{TotalInvoiceSumText}}', translate('Total invoice sum')],
        ['{{pleasePayText}}', translate('Please pay the invoice within 14 days')],
        ['{{thankYouText}}', translate('Thank you for your collaboration')],
        ['{{signatureText}}', translate('This invoice does not need a signature')],
        ['{{taxNumberText}}', translate('Tax number')],
        ['{{CEOText}}', translate('CEO')],
        ['{{bankText}}', translate('Bank')],
        ['{{userName}}', loggedUser.displayName],
        ['{{userRole}}', userRole],
        ['{{userCompany}}', userCompany],
        ['{{footer}}', footerText],
    ]

    const replacements = []

    replacementsData.forEach(data => {
        const text = data[0]
        const replaceText = data[1]
        const replacement = { replaceAllText: { replaceText, containsText: { text, matchCase: true } } }
        replacements.push(replacement)
    })

    return replacements
}

const getFooterText = fromData => {
    const {
        name: fromName,
        companyRegister: fromCompanyRegister,
        taxNumber: fromTaxNumber,
        vatId: fromVatId,
        ceo: fromCeo,
        bank: fromBank,
        bankAddress: fromBankAddress,
        iban: fromIban,
        bic: fromBic,
    } = fromData

    let footerText = ''

    footerText += fromName && fromName.trim() ? fromName + ' - ' : ''
    footerText +=
        fromCompanyRegister && fromCompanyRegister.trim()
            ? `${translate('Registry Number')}: ${fromCompanyRegister} - `
            : ''
    footerText += fromTaxNumber && fromTaxNumber.trim() ? `${translate('Tax number')}: ${fromTaxNumber} - ` : ''
    footerText += fromVatId && fromVatId.trim() ? `${translate('VAT ID')}: ${fromVatId} - ` : ''
    footerText += fromCeo && fromCeo.trim() ? `${translate('CEO')}: ${fromCeo} - ` : ''

    const showBank = !!(fromBank && fromBank.trim())
    const showBankAddress = !!(fromBankAddress && fromBankAddress.trim())
    footerText +=
        showBank || showBankAddress
            ? `${translate('Bank')}: ${
                  showBank && showBankAddress
                      ? `${fromBank}, ${fromBankAddress}`
                      : showBank
                      ? fromBank
                      : fromBankAddress
              } // `
            : ''

    footerText += fromIban && fromIban.trim() ? `${translate('IBAN')}: ${fromIban} // ` : ''
    footerText += fromBic && fromBic.trim() ? `${translate('BIC')}: ${fromBic}` : ''

    return footerText
}

export const getUsersData = (hourlyRatesData, usersData) => {
    const { currency } = hourlyRatesData

    let usersDataText = ''
    let totalSum = 0

    for (const user of usersData) {
        const time = user.time / 60
        const sum = time * user.hourlyRate
        const hourlyRateText = `${translate('Agreed on hourly rate')} ${user.hourlyRate} ${currency}`
        const timeDecimalsAmount = Number.isInteger(time) ? 0 : time.toString().split('.')[1].length
        const hoursInvoicedText = `${translate('Number of hours invoiced')} ${
            timeDecimalsAmount > 2 ? time.toFixed(2) : time
        }`
        const sumText = `${translate('Sum')} ${sum.toFixed(2)} ${currency}`
        usersDataText += `${user.name}\n${hourlyRateText}\n${hoursInvoicedText}\n${sumText}\n\n`
        totalSum += sum
    }

    return { usersDataText, totalSum }
}

export async function createInvoiceDoc(
    projectId,
    hourlyRatesData,
    fromData,
    toData,
    timestamps,
    invoiceNumber,
    usersDataText,
    totalSum,
    vatValue
) {
    const newDocument = await gapi.client.docs.documents.create({
        resource: { title: `Alldone Invoice ${invoiceNumber}` },
    })
    const { documentId } = newDocument.result
    const updateObject = {
        documentId,
        resource: {
            requests: getContentRequests(fromData.logo),
        },
    }
    await gapi.client.docs.documents.batchUpdate(updateObject)

    const createOFooter = {
        documentId,
        resource: {
            requests: [
                {
                    createFooter: {
                        type: 'DEFAULT',
                    },
                },
            ],
        },
    }
    const footerResult = await gapi.client.docs.documents.batchUpdate(createOFooter)
    const footerId = footerResult.result.replies[0].createFooter.footerId
    const updateOFooter = {
        documentId,
        resource: {
            requests: getFooterRequests(footerId),
        },
    }
    await gapi.client.docs.documents.batchUpdate(updateOFooter)

    await copyAndUpdateGoogleDoc(
        documentId,
        projectInvoiceReplacements(
            projectId,
            hourlyRatesData,
            fromData,
            toData,
            timestamps,
            invoiceNumber,
            usersDataText,
            totalSum,
            vatValue
        )
    )

    window.open(`https://docs.google.com/document/d/${documentId}/edit`, '_blank')
    return documentId
}
