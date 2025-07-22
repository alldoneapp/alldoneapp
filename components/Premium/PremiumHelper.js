import moment from 'moment'

import store from '../../redux/store'
import ProjectHelper from '../SettingsView/ProjectsSettings/ProjectHelper'
import { setLimitQuotaModalData, setShowLimitPremiumQuotaModal } from '../../redux/actions'
import { getUserData } from '../../utils/backends/Users/usersFirestore'

const QUOTA_XP_TYPE = 0
const QUOTA_TRAFFIC_TYPE = 1

export const PLAN_STATUS_FREE = 'free'
export const PLAN_STATUS_PREMIUM = 'premium'

export const PERSONAL_XP_QUOTE_LIMIT = 8000
export const PERSONAL_TRAFFIC_QUOTE_LIMIT = 20
export const PERSONAL_TRAFFIC_QUOTE_LIMIT_FOR_PREMIUM = 1024

export const PROJECT_XP_QUOTE_LIMIT = 50000
export const PROJECT_TRAFFIC_QUOTE_LIMIT = 40

export const NET_PRICE = 4.2
export const PRICE = 5
export const VAT_TO_APPLY = 0.8
export const VAT_PERCENT = 0.19

export const PERSONAL_QUOTA_TYPE = 0
export const PROJECT_QUOTA_TYPE = 1

export const PAYMENT_METHOD_CREDIT_CARD = 'creditcard'

export const SUBSCRIPTION_STATUS_INACTIVE = 'inactive'
export const SUBSCRIPTION_STATUS_PENDING = 'pending'
export const SUBSCRIPTION_STATUS_EDITING_USERS_PENDING = 'editingUsersPending'
export const SUBSCRIPTION_STATUS_ACTIVE = 'active'
export const SUBSCRIPTION_STATUS_CANCELED = 'canceled'
export const SUBSCRIPTION_STATUS_ACTIVATION_PENDING = 'activationPending'
export const SUBSCRIPTION_STATUS_UPDATE_CREDIT_CARD_PENDING = 'creditCardPending'

export const getPersonalXpQuote = xp => {
    return getXpQuote(xp, PERSONAL_XP_QUOTE_LIMIT)
}

export const getProjectXpQuote = xp => {
    return getXpQuote(xp, PROJECT_XP_QUOTE_LIMIT)
}

const getXpQuote = (xp, quotaLimit) => {
    return Number(((xp / quotaLimit) * 100).toFixed(1))
}

export const getPersonalTrafficQuote = traffic => {
    return getTrafficQuote(traffic, PERSONAL_TRAFFIC_QUOTE_LIMIT)
}

export const getProjectTrafficQuote = traffic => {
    return getTrafficQuote(traffic, PROJECT_TRAFFIC_QUOTE_LIMIT)
}

const getTrafficQuote = (traffic, quotaLimit) => {
    return Number(((traffic / quotaLimit) * 100).toFixed(1))
}

export const getPremiumTrafficQuote = traffic => {
    return Number(((traffic / PERSONAL_TRAFFIC_QUOTE_LIMIT_FOR_PREMIUM) * 100).toFixed(1))
}

export const calculatePrice = amountUsers => {
    return (amountUsers * PRICE).toFixed(2)
}

export const checkIsLimitedByXp = projectId => {
    return checkIsLimited(projectId, QUOTA_XP_TYPE)
}

export const checkIsLimitedByTraffic = projectId => {
    return checkIsLimited(projectId, QUOTA_TRAFFIC_TYPE)
}

const checkIsLimited = (projectId, quotaTypeToCheck) => {
    const { loggedUser } = store.getState()
    const isPremiumUser = loggedUser.premium.status === PLAN_STATUS_PREMIUM

    if (isPremiumUser) {
        return quotaTypeToCheck === QUOTA_TRAFFIC_TYPE && checkIsLimitedByPremiumTrafficQuota()
    } else {
        if (projectId && checkIsLimitedByProjectQuota(projectId, quotaTypeToCheck)) return true
        return checkIsLimitedByPersonalQuota(quotaTypeToCheck)
    }
}

const checkIsLimitedByPremiumTrafficQuota = () => {
    const { loggedUser } = store.getState()
    const { monthlyTraffic } = loggedUser

    const personalLimitReached = monthlyTraffic >= PERSONAL_TRAFFIC_QUOTE_LIMIT_FOR_PREMIUM
    if (personalLimitReached) store.dispatch(setShowLimitPremiumQuotaModal(true))
    return personalLimitReached
}

const checkIsLimitedByPersonalQuota = quotaTypeToCheck => {
    const { loggedUser } = store.getState()
    const { monthlyXp, monthlyTraffic } = loggedUser

    const personalLimitReached =
        quotaTypeToCheck === QUOTA_XP_TYPE
            ? monthlyXp >= PERSONAL_XP_QUOTE_LIMIT
            : monthlyTraffic >= PERSONAL_TRAFFIC_QUOTE_LIMIT

    if (personalLimitReached) {
        store.dispatch(setLimitQuotaModalData(true, PERSONAL_QUOTA_TYPE, '', monthlyXp, monthlyTraffic))
    }
    return personalLimitReached
}

const checkIsLimitedByProjectQuota = (projectId, quotaTypeToCheck) => {
    const project = ProjectHelper.getProjectById(projectId)

    if (project) {
        const { monthlyXp, monthlyTraffic } = project
        const projectLimitReached =
            quotaTypeToCheck === QUOTA_XP_TYPE
                ? monthlyXp >= PROJECT_XP_QUOTE_LIMIT
                : monthlyTraffic >= PROJECT_TRAFFIC_QUOTE_LIMIT
        if (projectLimitReached) {
            store.dispatch(setLimitQuotaModalData(true, PROJECT_QUOTA_TYPE, name, monthlyXp, monthlyTraffic))
        }
        return projectLimitReached
    } else {
        return true
    }
}

export const getSubscriptionStatus = subscription => {
    const subscriptionStatus = subscription ? subscription.status : null
    const isInactiveSubscription = subscriptionStatus === SUBSCRIPTION_STATUS_INACTIVE
    const isPendingSubscription = subscriptionStatus === SUBSCRIPTION_STATUS_PENDING
    const isActiveSubscription = subscriptionStatus === SUBSCRIPTION_STATUS_ACTIVE
    const isEditingUsersPendingSubscription = subscriptionStatus === SUBSCRIPTION_STATUS_EDITING_USERS_PENDING
    const isCanceledSubscription = subscriptionStatus === SUBSCRIPTION_STATUS_CANCELED
    const isActivationPendingSubscription = subscriptionStatus === SUBSCRIPTION_STATUS_ACTIVATION_PENDING
    const isUpdateCreditCardPendingSubscription = subscriptionStatus === SUBSCRIPTION_STATUS_UPDATE_CREDIT_CARD_PENDING
    return {
        isInactiveSubscription,
        isPendingSubscription,
        isActiveSubscription,
        isEditingUsersPendingSubscription,
        isCanceledSubscription,
        isActivationPendingSubscription,
        isUpdateCreditCardPendingSubscription,
    }
}

export const getDaysLeftUntilNextPaymentPercent = nextPaymentDate => {
    const DAYS_IN_ONE_SUBSCRIPTION = 30
    const MINIMUM_PAYMENT_PERCENT = 0.03
    const today = moment()
    const nextPayment = moment(nextPaymentDate, 'YYYY-MM-DD')
    const daysLeftUntilNextPayment = nextPayment.diff(today, 'days')
    let daysLeftUntilNextPaymentPercent = daysLeftUntilNextPayment / DAYS_IN_ONE_SUBSCRIPTION
    daysLeftUntilNextPaymentPercent =
        daysLeftUntilNextPaymentPercent > 0 ? daysLeftUntilNextPaymentPercent : MINIMUM_PAYMENT_PERCENT
    return daysLeftUntilNextPaymentPercent
}

export const removeUsersPaidByOtherUser = async selectedUserIds => {
    const { loggedUser, projectUsers } = store.getState()
    const usersByProject = Object.values(projectUsers)
    const users = {}
    usersByProject.forEach(users => {
        users.forEach(user => {
            users[user.uid] = user
        })
    })
    const usersToPayForIds = []
    for (let i = 0; i < selectedUserIds.length; i++) {
        const userId = selectedUserIds[i]
        const user = users[userId] ? users[userId] : await getUserData(userId, false)
        if (user) {
            const { premium } = user
            const paidByOtherUser = premium.status === PLAN_STATUS_PREMIUM && premium.userPayingId !== loggedUser.uid
            if (!paidByOtherUser) usersToPayForIds.push(userId)
        }
    }

    return usersToPayForIds
}
