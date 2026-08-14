/**
 * Reminder delivery channels (AT-2211).
 *
 * A task alert normally fans out to whatever channels the user enabled globally in
 * Notification Settings (push / email / WhatsApp). That is the right default for a
 * reminder created in the app, but it is wrong for one the user asked for *inside*
 * WhatsApp: "Erinnere mich morgen um 10 Uhr daran, X zu tun" plainly means "send me a
 * WhatsApp at 10", and silently routing it to a push notification because the global
 * WhatsApp toggle happens to be off reads as the feature being broken.
 *
 * So the origin channel is stamped onto the task when the alert is set, and the alert
 * scanner treats it as an additional reason to deliver on that channel. It is strictly
 * additive: it can only ever turn a channel ON for a task that explicitly requested it,
 * and it never disables or reroutes push / email / in-app delivery.
 */

const REMINDER_CHANNEL_WHATSAPP = 'whatsapp'

/**
 * `type` stamped on the `pushNotifications` doc a task alert writes.
 *
 * Shared by the producer (checkAndTriggerTaskAlerts) and the consumer
 * (sendWhatsAppForNotifications, which must skip these to avoid a double WhatsApp send),
 * so the two cannot drift apart on a string literal.
 */
const ALERT_NOTIFICATION_TYPE = 'Alert Notification'

/**
 * Source channels that should get their reminders back over WhatsApp.
 * Both the text bridge ('whatsapp') and the realtime voice call ('whatsapp_call')
 * count — from the user's side they are the same conversation on the same phone.
 */
const WHATSAPP_SOURCE_CHANNELS = new Set(['whatsapp', 'whatsapp_call'])

/**
 * Map an assistant runtime `sourceChannel` to the reminder channels it implies.
 *
 * Returns an array (rather than a single value) so additional origin channels can be
 * added later without changing the shape stored on the task.
 *
 * @param {string|null|undefined} sourceChannel toolRuntimeContext.sourceChannel
 * @returns {string[]} e.g. ['whatsapp'], or [] for channels with no implied routing
 */
function resolveReminderChannelsFromSource(sourceChannel) {
    if (typeof sourceChannel !== 'string') return []
    const normalized = sourceChannel.trim().toLowerCase()
    if (WHATSAPP_SOURCE_CHANNELS.has(normalized)) return [REMINDER_CHANNEL_WHATSAPP]
    return []
}

/**
 * Read the channels a task explicitly requested, tolerating legacy/malformed docs.
 *
 * @param {Object|null|undefined} task
 * @returns {string[]}
 */
function getTaskReminderChannels(task) {
    const channels = task && task.alertChannels
    if (!Array.isArray(channels)) return []
    return channels.filter(channel => typeof channel === 'string' && channel.trim().length > 0)
}

/**
 * Whether a task explicitly asked for its reminder on the given channel.
 *
 * @param {Object|null|undefined} task
 * @param {string} channel
 * @returns {boolean}
 */
function taskRequestsReminderChannel(task, channel) {
    if (typeof channel !== 'string' || !channel) return false
    const target = channel.trim().toLowerCase()
    return getTaskReminderChannels(task).some(entry => entry.trim().toLowerCase() === target)
}

/**
 * Decide whether a task alert should be delivered over WhatsApp.
 *
 * A phone number is non-negotiable — without it there is nowhere to send. Beyond that,
 * either the user's global opt-in (existing behaviour, unchanged) OR the task's own
 * origin-channel request is enough.
 *
 * @param {Object|null|undefined} user user doc (needs `phone`, `receiveWhatsApp`)
 * @param {Object|null|undefined} task task doc (may carry `alertChannels`)
 * @returns {boolean}
 */
function shouldSendWhatsAppReminder(user, task) {
    if (!user || !user.phone) return false
    if (user.receiveWhatsApp) return true
    return taskRequestsReminderChannel(task, REMINDER_CHANNEL_WHATSAPP)
}

module.exports = {
    REMINDER_CHANNEL_WHATSAPP,
    ALERT_NOTIFICATION_TYPE,
    WHATSAPP_SOURCE_CHANNELS,
    resolveReminderChannelsFromSource,
    getTaskReminderChannels,
    taskRequestsReminderChannel,
    shouldSendWhatsAppReminder,
}
