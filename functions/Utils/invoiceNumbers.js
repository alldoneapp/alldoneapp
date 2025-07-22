const admin = require('firebase-admin')

const resetInvoiceNumbers = async () => {
    const userNumberDocs = (
        await admin.firestore().collection(`invoiceNumbers/customInvoiceNumber/users`).where('number', '>', 0).get()
    ).docs

    const promises = []
    promises.push(admin.firestore().doc('invoiceNumbers/premiumInvoiceNumber').set({ number: 0 }))
    userNumberDocs.forEach(doc => {
        promises.push(admin.firestore().doc(`invoiceNumbers/customInvoiceNumber/users/${doc.id}`).set({ number: 0 }))
    })
    await Promise.all(promises)
}

module.exports = { resetInvoiceNumbers }
