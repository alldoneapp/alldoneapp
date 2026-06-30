import { ANALYTICS_ENABLED, GOOGLE_ANALYTICS_KEY } from './analyticsConfig'

export { ANALYTICS_ENABLED, GOOGLE_ANALYTICS_KEY }
export const ANALYTICS_CONSENT_STORAGE_KEY = 'alldone.analyticsConsent.v1'

export const ANALYTICS_CONSENT_GRANTED = 'granted'
export const ANALYTICS_CONSENT_DENIED = 'denied'
export const ANALYTICS_CONSENT_UNKNOWN = 'unknown'

export const ANALYTICS_CONSENT_CHANGED_EVENT = 'alldone:analytics-consent-changed'
export const ANALYTICS_CONSENT_DIALOG_EVENT = 'alldone:analytics-consent-dialog'

const CONSENT_VERSION = 1
const GOOGLE_TAG_SCRIPT_ID = 'alldone-google-analytics'
const PRODUCTION_HOST = 'my.alldone.app'

const ALLOWED_EVENTS = new Set([
    'page_view',
    'login',
    'sign_up',
    'begin_checkout',
    'start_trial',
    'generate_lead',
    'purchase',
    'refund',
    'earn_virtual_currency',
    'spend_virtual_currency',
    'onboarding_step',
    'integration_connected',
    'integration_skipped',
    'object_created',
    'object_completed',
    'object_postponed',
    'note_opened',
    'note_closed',
    'upgrade_interaction',
    'billing_action',
    'quota_threshold_reached',
    'focus_changed',
    'account_deleted',
])

const ALLOWED_PARAMETERS = new Set([
    'method',
    'object_type',
    'plan',
    'integration',
    'provider',
    'threshold',
    'quota_type',
    'scope',
    'action',
    'step',
    'source',
    'currency',
    'value',
    'transaction_id',
    'affiliation',
    'virtual_currency_name',
    'item_id',
    'item_name',
    'count',
    'is_in_workflow',
    'page_title',
    'page_path',
    'page_location',
])

const OBJECT_EVENT_TYPES = {
    new_project: 'project',
    new_task: 'task',
    new_goal: 'goal',
    new_note: 'note',
    new_contact: 'contact',
    new_assistant: 'assistant',
    new_skill: 'skill',
    new_workstream: 'workstream',
    new_chat: 'chat',
    new_chat_message: 'chat_message',
}

const UPGRADE_EVENT_ACTIONS = {
    open_premium_tab: 'view',
    click_on_upgrade_to_premium: 'select_upgrade',
    click_premium_payment_link: 'select_premium_payment',
    click_gold_payment_link: 'select_gold_payment',
}

const BILLING_EVENT_ACTIONS = {
    click_connect_payment: 'connect_payment',
    click_to_mollie: 'open_mollie',
    click_manage_billing: 'manage_billing',
    add_invoce_address: 'add_invoice_address',
    update_invoce_address: 'update_invoice_address',
}

let initialized = false
let currentUserId = null
let lastPagePath = null
let analyticsEnabledForTests = null

const canUseBrowser = () => typeof window !== 'undefined' && typeof document !== 'undefined'

export function isAnalyticsEnabled() {
    if (analyticsEnabledForTests !== null) return analyticsEnabledForTests
    return (
        ANALYTICS_ENABLED &&
        typeof GOOGLE_ANALYTICS_KEY === 'string' &&
        /^G-[A-Z0-9]+$/.test(GOOGLE_ANALYTICS_KEY) &&
        canUseBrowser() &&
        window.location.hostname === PRODUCTION_HOST
    )
}

export function getAnalyticsConsentRecord() {
    if (!canUseBrowser()) return { status: ANALYTICS_CONSENT_UNKNOWN, version: CONSENT_VERSION, updatedAt: null }

    try {
        const storedValue = window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)
        if (!storedValue) return { status: ANALYTICS_CONSENT_UNKNOWN, version: CONSENT_VERSION, updatedAt: null }

        const record = JSON.parse(storedValue)
        const status = [ANALYTICS_CONSENT_GRANTED, ANALYTICS_CONSENT_DENIED].includes(record.status)
            ? record.status
            : ANALYTICS_CONSENT_UNKNOWN

        return {
            status,
            version: Number(record.version) || CONSENT_VERSION,
            updatedAt: Number(record.updatedAt) || null,
        }
    } catch (error) {
        return { status: ANALYTICS_CONSENT_UNKNOWN, version: CONSENT_VERSION, updatedAt: null }
    }
}

export const getAnalyticsConsent = () => getAnalyticsConsentRecord().status

const dispatchBrowserEvent = (name, detail) => {
    if (!canUseBrowser() || typeof window.dispatchEvent !== 'function') return
    window.dispatchEvent(new CustomEvent(name, { detail }))
}

const configureDataLayer = () => {
    window.dataLayer = window.dataLayer || []
    window.gtag =
        window.gtag ||
        function () {
            window.dataLayer.push(arguments)
        }
}

const deleteAnalyticsCookies = () => {
    if (!canUseBrowser()) return

    document.cookie.split(';').forEach(cookie => {
        const cookieName = cookie.split('=')[0].trim()
        if (!cookieName.startsWith('_ga')) return

        const expiration = 'expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; path=/'
        document.cookie = `${cookieName}=; ${expiration}`
        document.cookie = `${cookieName}=; ${expiration}; domain=.alldone.app`
        document.cookie = `${cookieName}=; ${expiration}; domain=my.alldone.app`
    })
}

export function initializeAnalytics() {
    if (!isAnalyticsEnabled() || getAnalyticsConsent() !== ANALYTICS_CONSENT_GRANTED) return false
    if (initialized) return true

    configureDataLayer()
    window[`ga-disable-${GOOGLE_ANALYTICS_KEY}`] = false
    window.gtag('consent', 'default', {
        analytics_storage: 'granted',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
    })
    window.gtag('js', new Date())
    window.gtag('config', GOOGLE_ANALYTICS_KEY, {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        ...(currentUserId ? { user_id: currentUserId } : {}),
    })

    if (!document.getElementById(GOOGLE_TAG_SCRIPT_ID)) {
        const script = document.createElement('script')
        script.id = GOOGLE_TAG_SCRIPT_ID
        script.async = true
        script.src = `https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_KEY}`
        document.head.appendChild(script)
    }

    initialized = true
    return true
}

export function setAnalyticsConsent(status) {
    if (![ANALYTICS_CONSENT_GRANTED, ANALYTICS_CONSENT_DENIED].includes(status)) {
        throw new Error(`Unsupported analytics consent status: ${status}`)
    }

    const record = { status, version: CONSENT_VERSION, updatedAt: Date.now() }
    if (canUseBrowser()) {
        window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, JSON.stringify(record))
    }

    if (status === ANALYTICS_CONSENT_GRANTED) {
        if (canUseBrowser()) window[`ga-disable-${GOOGLE_ANALYTICS_KEY}`] = false
        initializeAnalytics()
        if (initialized) window.gtag('consent', 'update', { analytics_storage: 'granted' })
    } else if (canUseBrowser()) {
        window[`ga-disable-${GOOGLE_ANALYTICS_KEY}`] = true
        if (typeof window.gtag === 'function') {
            window.gtag('consent', 'update', {
                analytics_storage: 'denied',
                ad_storage: 'denied',
                ad_user_data: 'denied',
                ad_personalization: 'denied',
            })
        }
        deleteAnalyticsCookies()
        lastPagePath = null
    }

    dispatchBrowserEvent(ANALYTICS_CONSENT_CHANGED_EVENT, record)
    return record
}

export function openAnalyticsConsentSettings() {
    dispatchBrowserEvent(ANALYTICS_CONSENT_DIALOG_EVENT, { open: true })
}

export function setAnalyticsUser(userId) {
    currentUserId = userId || null
    if (!initializeAnalytics()) return

    window.gtag('config', GOOGLE_ANALYTICS_KEY, {
        send_page_view: false,
        user_id: currentUserId,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
    })
}

const sanitizeValue = value => {
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
    if (typeof value === 'string') return value.substring(0, 100)
    return undefined
}

export function sanitizeAnalyticsParameters(params = {}) {
    return Object.entries(params).reduce((sanitized, [key, value]) => {
        if (!ALLOWED_PARAMETERS.has(key)) return sanitized
        const sanitizedValue = sanitizeValue(value)
        if (sanitizedValue !== undefined) sanitized[key] = sanitizedValue
        return sanitized
    }, {})
}

export function normalizeAnalyticsEvent(name, params = {}) {
    if (ALLOWED_EVENTS.has(name)) return { name, params: sanitizeAnalyticsParameters(params) }

    if (OBJECT_EVENT_TYPES[name]) {
        return { name: 'object_created', params: { object_type: OBJECT_EVENT_TYPES[name] } }
    }

    if (UPGRADE_EVENT_ACTIONS[name]) {
        return { name: 'upgrade_interaction', params: { action: UPGRADE_EVENT_ACTIONS[name] } }
    }

    if (BILLING_EVENT_ACTIONS[name]) {
        return { name: 'billing_action', params: { action: BILLING_EVENT_ACTIONS[name] } }
    }

    switch (name) {
        case 'new_user':
            return { name: 'sign_up', params: { method: 'google' } }
        case 'delete_user':
            return { name: 'account_deleted', params: {} }
        case 'done_task':
            return {
                name: 'object_completed',
                params: { object_type: 'task', is_in_workflow: Boolean(params.isInWorkflow) },
            }
        case 'UnlockGoal':
            return { name: 'object_completed', params: { object_type: 'goal' } }
        case 'task_postponed':
            return { name: 'object_postponed', params: { object_type: 'task' } }
        case 'goal_postponed':
            return { name: 'object_postponed', params: { object_type: 'goal' } }
        case 'open_note':
            return { name: 'note_opened', params: {} }
        case 'exiting_note':
            return { name: 'note_closed', params: {} }
        case 'menubar_app_token_minted':
            return { name: 'integration_connected', params: { integration: 'menubar_app' } }
        case 'trial_conversion_completed':
            return { name: 'start_trial', params: { plan: params.plan_type || 'unknown', provider: 'stripe' } }
        case 'onboarding_calendar_connected':
            return { name: 'integration_connected', params: { integration: 'calendar' } }
        case 'onboarding_whatsapp_connected':
            return { name: 'integration_connected', params: { integration: 'whatsapp' } }
        case 'onboarding_push_enabled':
            return { name: 'integration_connected', params: { integration: 'push' } }
        case 'onboarding_check_in_preference_enabled':
            return { name: 'onboarding_step', params: { step: 'check_in_preference' } }
        case 'onboarding_calendar_skipped':
            return { name: 'integration_skipped', params: { integration: 'calendar' } }
        case 'onboarding_gmail_skipped':
            return { name: 'integration_skipped', params: { integration: 'gmail' } }
        case 'onboarding_whatsapp_skipped':
            return { name: 'integration_skipped', params: { integration: 'whatsapp' } }
        case 'onboarding_push_skipped':
            return { name: 'integration_skipped', params: { integration: 'push' } }
        case 'onboarding_check_in_preference_skipped':
            return { name: 'integration_skipped', params: { integration: 'check_in_preference' } }
        case 'login_page':
        case 'update_feeds':
            return null
        default:
            return null
    }
}

export function trackEvent(name, params = {}) {
    if (!initializeAnalytics()) return false

    const event = normalizeAnalyticsEvent(name, params)
    if (!event) return false

    window.gtag('event', event.name, event.params)
    return true
}

const PAGE_PATHS = {
    LoginScreen: '/login',
    Onboarding: '/starttrial',
    WhatsAppOnboarding: '/onboarding/integrations',
    PaymentSuccess: '/paymentsuccess',
    PrivateResource: '/private-resource',
    AppAuth: '/app/authorize',
    Root: '/app',
    ROOT_TASKS: '/app/tasks',
    ROOT_NOTES: '/app/notes',
    ROOT_GOALS: '/app/goals',
    ROOT_CONTACTS: '/app/contacts',
    ROOT_CHATS: '/app/chats',
    ROOT_UPDATES: '/app/updates',
    SettingsView: '/app/settings',
    AdminPanelView: '/app/admin',
    TaskDetailedView: '/app/tasks/detail',
    GoalDetailedView: '/app/goals/detail',
    NotesDetailedView: '/app/notes/detail',
    ContactDetailedView: '/app/contacts/detail',
    UserDetailedView: '/app/users/detail',
    ProjectDetailedView: '/app/projects/detail',
    AssistantDetailedView: '/app/assistants/detail',
    SkillDetailedView: '/app/skills/detail',
    ChatDetailedView: '/app/chats/detail',
}

const getPageDefinition = pageKey => {
    const normalizedKey = String(pageKey || 'Root')
    const path = PAGE_PATHS[normalizedKey] || '/app/other'
    const title = PAGE_PATHS[normalizedKey]
        ? `Alldone - ${normalizedKey.replace(/([a-z])([A-Z])/g, '$1 $2')}`
        : 'Alldone - App'

    return { path, title }
}

export function trackPageView(pageKey) {
    if (!initializeAnalytics()) return false

    const page = getPageDefinition(pageKey)
    if (lastPagePath === page.path) return false

    lastPagePath = page.path
    return trackEvent('page_view', {
        page_title: page.title,
        page_path: page.path,
        page_location: `https://${PRODUCTION_HOST}${page.path}`,
    })
}

export function getAnalyticsClientId(timeoutMs = 5000) {
    if (!initializeAnalytics()) return Promise.resolve(null)

    return new Promise(resolve => {
        let completed = false
        const timeout = setTimeout(() => {
            if (!completed) resolve(null)
            completed = true
        }, timeoutMs)

        window.gtag('get', GOOGLE_ANALYTICS_KEY, 'client_id', clientId => {
            if (completed) return
            completed = true
            clearTimeout(timeout)
            resolve(typeof clientId === 'string' && clientId.length > 0 ? clientId : null)
        })
    })
}

export function __resetAnalyticsForTests() {
    initialized = false
    currentUserId = null
    lastPagePath = null
    analyticsEnabledForTests = null
}

export function __setAnalyticsEnabledForTests(enabled) {
    analyticsEnabledForTests = enabled
}
