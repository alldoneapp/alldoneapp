const { createMollieClient } = require('@mollie/api-client')
const { getEnvFunctions } = require('../envFunctionsHelper')

const { MOLLIE_API_KEY } = getEnvFunctions()
const mollieClient = createMollieClient({ apiKey: MOLLIE_API_KEY })
const PRICE = 5

const SUBSCRIPTION_STATUS_INACTIVE = 'inactive'
const SUBSCRIPTION_STATUS_PENDING = 'pending'
const SUBSCRIPTION_STATUS_EDITING_USERS_PENDING = 'editingUsersPending'
const SUBSCRIPTION_STATUS_ACTIVE = 'active'
const SUBSCRIPTION_STATUS_CANCELED = 'canceled'
const SUBSCRIPTION_STATUS_ACTIVATION_PENDING = 'activationPending'
const SUBSCRIPTION_STATUS_UPDATE_CREDIT_CARD_PENDING = 'creditCardPending'

const PAYMENT_TYPE_CREATE_SUBSCRIPTION = 'createSubscription'
const PAYMENT_TYPE_ADD_USERS_WHEN_EDIT_SUBSCRIPTION = 'addUsersWhenEditSubscription'
const PAYMENT_TYPE_ADD_USERS_WHEN_ACTIVATE_SUBSCRIPTION = 'addUsersWhenActivateSubscription'
const PAYMENT_TYPE_UPDATE_CREDIT_CARD = 'updateCreditCard'

const createCustomer = async (name, email) => {
    const customerData = await mollieClient.customers.create({ name, email })
    return customerData
}

const createPayment = async (customerId, amountToPay, urlOrigin, description, sequenceType, metadata) => {
    const { MOLLIE_WEBHOOK } = getEnvFunctions()
    const paymentData = await mollieClient.payments.create({
        customerId,
        amount: {
            value: amountToPay.toFixed(2),
            currency: 'EUR',
        },
        method: 'creditcard',
        sequenceType,
        description,
        redirectUrl: `${urlOrigin}/settings/premium`,
        webhookUrl: MOLLIE_WEBHOOK,
        metadata,
    })
    return paymentData
}

const revokeMandate = async (mandateId, customerId) => {
    await mollieClient.customers_mandates.revoke(mandateId, { customerId })
}

const getPayment = async paymentId => {
    const payment = await mollieClient.payments.get(paymentId)
    return payment
}

const updatePaymentMetaData = async (paymentId, metadata) => {
    await mollieClient.payments.update(paymentId, {
        metadata,
    })
}

const createMollieSubscription = async (customerId, usersToPayAmount, companyName, userPayingId, startDate) => {
    const { MOLLIE_SEND_MONTHLY_INVOICE } = getEnvFunctions()
    const subscriptionData = {
        customerId,
        amount: {
            currency: 'EUR',
            value: (usersToPayAmount * PRICE).toFixed(2),
        },
        interval: '1 month',
        description: `Monthly payment (${companyName})`,
        metadata: { userPayingId },
        webhookUrl: MOLLIE_SEND_MONTHLY_INVOICE,
    }
    if (startDate) subscriptionData.startDate = startDate
    const mollieSubscription = await mollieClient.customers_subscriptions.create(subscriptionData)
    return mollieSubscription
}

const getMollieSubscription = async (subscriptionIdInMollie, customerId) => {
    const mollieSubscription = await mollieClient.customers_subscriptions.get(subscriptionIdInMollie, {
        customerId,
    })
    return mollieSubscription
}

const cancelMollieSubscription = async (subscriptionIdInMollie, customerId) => {
    mollieClient.customers_subscriptions.cancel(subscriptionIdInMollie, { customerId })
}

const updateMollieSubscriptionAmount = async (subscriptionIdInMollie, customerId, usersToPayAmount) => {
    await mollieClient.customers_subscriptions.update(subscriptionIdInMollie, {
        customerId,
        amount: {
            currency: 'EUR',
            value: (usersToPayAmount * PRICE).toFixed(2),
        },
    })
}

const updateMollieSubscription = async (subscriptionIdInMollie, customerId, dataToUpdate) => {
    const mollieClient = createMollieClient({ apiKey: MOLLIE_API_KEY })
    await mollieClient.customers_subscriptions.update(subscriptionIdInMollie, {
        customerId,
        ...dataToUpdate,
    })
}

module.exports = {
    createCustomer,
    createPayment,
    getPayment,
    updatePaymentMetaData,
    createMollieSubscription,
    getMollieSubscription,
    updateMollieSubscriptionAmount,
    cancelMollieSubscription,
    revokeMandate,
    SUBSCRIPTION_STATUS_ACTIVE,
    SUBSCRIPTION_STATUS_INACTIVE,
    SUBSCRIPTION_STATUS_CANCELED,
    SUBSCRIPTION_STATUS_EDITING_USERS_PENDING,
    SUBSCRIPTION_STATUS_ACTIVATION_PENDING,
    SUBSCRIPTION_STATUS_UPDATE_CREDIT_CARD_PENDING,
    PRICE,
    PAYMENT_TYPE_CREATE_SUBSCRIPTION,
    PAYMENT_TYPE_ADD_USERS_WHEN_EDIT_SUBSCRIPTION,
    PAYMENT_TYPE_ADD_USERS_WHEN_ACTIVATE_SUBSCRIPTION,
    PAYMENT_TYPE_UPDATE_CREDIT_CARD,
    SUBSCRIPTION_STATUS_PENDING,
    updateMollieSubscription,
}
