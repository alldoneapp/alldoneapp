'use strict'

const moment = require('moment-timezone')
const SibApiV3Sdk = require('sib-api-v3-sdk')
const { getUserData } = require('../Users/usersFirestore')
const { getEnvFunctions } = require('../envFunctionsHelper')

const NO_REPLY_SENDER = { email: 'noreply@alldone.app', name: 'Alldone.app' }
const EXCLUDED_EMAIL = 'alldoneapp@exdream.com'
const ALLDONE_MARKETING_URL = 'https://alldone.app'

function resolveTransactApi() {
    const { SIB_API_KEY } = getEnvFunctions()
    if (!SIB_API_KEY) return null
    const defaultClient = SibApiV3Sdk.ApiClient.instance
    defaultClient.authentications['api-key'].apiKey = SIB_API_KEY
    return new SibApiV3Sdk.TransactionalEmailsApi()
}

function escapeHtml(value) {
    return String(value == null ? '' : value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

function formatMeetingTime(start, end, timeZone) {
    const zone = timeZone && moment.tz.zone(timeZone) ? timeZone : 'UTC'
    const startMoment = moment.parseZone(start).tz(zone)
    const endMoment = moment.parseZone(end).tz(zone)
    if (!startMoment.isValid() || !endMoment.isValid()) return ''
    const datePart = startMoment.format('dddd, MMMM D, YYYY')
    const timePart = `${startMoment.format('HH:mm')} – ${endMoment.format('HH:mm')}`
    return `${datePart} · ${timePart} (${zone})`
}

function buildDetailRow(label, valueHtml) {
    return (
        `<tr>` +
        `<td style="padding: 6px 0; color: #6b7280; font-size: 14px; vertical-align: top; white-space: nowrap;">${escapeHtml(
            label
        )}</td>` +
        `<td style="padding: 6px 0 6px 16px; color: #111827; font-size: 14px; vertical-align: top;">${valueHtml}</td>` +
        `</tr>`
    )
}

function buildHostEmailHtml({ visitorName, visitorEmail, note, meetingTimeText, durationMinutes, eventHtmlLink }) {
    const rows = [
        buildDetailRow('Name', escapeHtml(visitorName)),
        buildDetailRow(
            'Email',
            `<a href="mailto:${escapeHtml(visitorEmail)}" style="color: #2563eb; text-decoration: none;">${escapeHtml(
                visitorEmail
            )}</a>`
        ),
    ]
    if (meetingTimeText) rows.push(buildDetailRow('When', escapeHtml(meetingTimeText)))
    if (Number.isFinite(durationMinutes)) rows.push(buildDetailRow('Duration', `${durationMinutes} minutes`))
    if (note) {
        rows.push(buildDetailRow('Note', escapeHtml(note).replace(/\n/g, '<br />')))
    }

    const calendarButton = eventHtmlLink
        ? `<div style="margin: 28px 0 8px 0;">` +
          `<a href="${escapeHtml(eventHtmlLink)}" ` +
          `style="display: inline-block; background: #2563eb; color: #ffffff; text-decoration: none; ` +
          `font-size: 14px; font-weight: 600; padding: 12px 22px; border-radius: 8px;">View in your calendar</a>` +
          `</div>`
        : ''

    return (
        `<div style="background: #f3f4f6; padding: 32px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">` +
        `<div style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">` +
        `<h1 style="margin: 0 0 8px 0; font-size: 20px; color: #111827;">New meeting booked</h1>` +
        `<p style="margin: 0 0 24px 0; font-size: 15px; color: #4b5563; line-height: 1.5;">` +
        `${escapeHtml(visitorName)} just booked a meeting with you through your Alldone.app booking link. ` +
        `It has been added to your calendar.` +
        `</p>` +
        `<table style="width: 100%; border-collapse: collapse;">${rows.join('')}</table>` +
        calendarButton +
        `</div>` +
        `<p style="max-width: 520px; margin: 20px auto 0 auto; text-align: center; font-size: 12px; color: #9ca3af;">` +
        `Sent by Alldone.app` +
        `</p>` +
        `</div>`
    )
}

/**
 * Notify the meeting host by email when someone books a slot through their public
 * booking link. Fails soft: any error is logged and swallowed so it never blocks
 * the booking response or the calendar event creation.
 */
async function sendBookingNotificationToHost({
    userId,
    visitorName,
    visitorEmail,
    note,
    start,
    end,
    timeZone,
    durationMinutes,
    eventHtmlLink,
}) {
    try {
        const hostData = (await getUserData(userId)) || {}
        const hostEmail = hostData.notificationEmail || hostData.email
        if (!hostEmail || hostEmail === EXCLUDED_EMAIL) return

        const transactApi = resolveTransactApi()
        if (!transactApi) {
            console.log('sendBookingNotificationToHost: missing SIB_API_KEY, skipping host notification email')
            return
        }

        const meetingTimeText = formatMeetingTime(start, end, timeZone)
        const htmlContent = buildHostEmailHtml({
            visitorName,
            visitorEmail,
            note,
            meetingTimeText,
            durationMinutes,
            eventHtmlLink,
        })

        const sendSmtpEmail = {
            sender: NO_REPLY_SENDER,
            to: [{ email: hostEmail }],
            replyTo: { email: visitorEmail, name: visitorName },
            subject: `New meeting booked: ${visitorName}`,
            htmlContent,
            headers: { Connection: 'keep-alive' },
        }

        await transactApi.sendTransacEmail(sendSmtpEmail)
    } catch (error) {
        console.log('sendBookingNotificationToHost: failed to send host notification email')
        console.log(error)
    }
}

function buildAlldonePitchFooter() {
    return (
        `<div style="max-width: 520px; margin: 16px auto 0 auto; background: #ffffff; border-radius: 12px; ` +
        `padding: 20px 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">` +
        `<p style="margin: 0 0 6px 0; font-size: 14px; font-weight: 600; color: #111827;">Booked with Alldone</p>` +
        `<p style="margin: 0 0 12px 0; font-size: 13px; color: #6b7280; line-height: 1.5;">` +
        `Alldone is an AI Chief of Staff that handles your meetings, email, tasks, and projects — ` +
        `so scheduling like this just happens for you.` +
        `</p>` +
        `<a href="${ALLDONE_MARKETING_URL}" ` +
        `style="display: inline-block; font-size: 13px; font-weight: 600; color: #2563eb; text-decoration: none;">` +
        `Get your own AI Chief of Staff →</a>` +
        `</div>`
    )
}

function buildVisitorEmailHtml({ visitorName, hostName, note, meetingTimeText, durationMinutes }) {
    const safeHostName = escapeHtml(hostName) || 'your host'
    const rows = []
    rows.push(buildDetailRow('With', safeHostName))
    if (meetingTimeText) rows.push(buildDetailRow('When', escapeHtml(meetingTimeText)))
    if (Number.isFinite(durationMinutes)) rows.push(buildDetailRow('Duration', `${durationMinutes} minutes`))
    if (note) {
        rows.push(buildDetailRow('Your note', escapeHtml(note).replace(/\n/g, '<br />')))
    }

    return (
        `<div style="background: #f3f4f6; padding: 32px 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">` +
        `<div style="max-width: 520px; margin: 0 auto; background: #ffffff; border-radius: 12px; padding: 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">` +
        `<h1 style="margin: 0 0 8px 0; font-size: 20px; color: #111827;">Your meeting is confirmed</h1>` +
        `<p style="margin: 0 0 24px 0; font-size: 15px; color: #4b5563; line-height: 1.5;">` +
        `Hi ${escapeHtml(visitorName) || 'there'}, your meeting with ${safeHostName} is booked. ` +
        `You'll find it on your calendar and can reply to this email if you need to make a change.` +
        `</p>` +
        `<table style="width: 100%; border-collapse: collapse;">${rows.join('')}</table>` +
        `</div>` +
        buildAlldonePitchFooter() +
        `</div>`
    )
}

/**
 * Confirm the booking to the visitor who booked the slot, with a short footer
 * pitching Alldone. Fails soft: any error is logged and swallowed so it never
 * blocks the booking response or the calendar event creation.
 */
async function sendBookingConfirmationToVisitor({
    visitorName,
    visitorEmail,
    hostName,
    note,
    start,
    end,
    timeZone,
    durationMinutes,
}) {
    try {
        if (!visitorEmail || visitorEmail === EXCLUDED_EMAIL) return

        const transactApi = resolveTransactApi()
        if (!transactApi) {
            console.log('sendBookingConfirmationToVisitor: missing SIB_API_KEY, skipping visitor confirmation email')
            return
        }

        const meetingTimeText = formatMeetingTime(start, end, timeZone)
        const htmlContent = buildVisitorEmailHtml({
            visitorName,
            hostName,
            note,
            meetingTimeText,
            durationMinutes,
        })

        const subject = hostName ? `Meeting confirmed with ${hostName}` : 'Your meeting is confirmed'
        const sendSmtpEmail = {
            sender: NO_REPLY_SENDER,
            to: [{ email: visitorEmail }],
            subject,
            htmlContent,
            headers: { Connection: 'keep-alive' },
        }

        await transactApi.sendTransacEmail(sendSmtpEmail)
    } catch (error) {
        console.log('sendBookingConfirmationToVisitor: failed to send visitor confirmation email')
        console.log(error)
    }
}

module.exports = {
    sendBookingNotificationToHost,
    sendBookingConfirmationToVisitor,
    formatMeetingTime,
    buildHostEmailHtml,
    buildVisitorEmailHtml,
}
