import { getHostingUrl, runHttpsCallableFunction } from '../firestore'

export const getBookingSettings = async () => {
    return await runHttpsCallableFunction('getBookingSettingsSecondGen', {})
}

export const saveBookingSettings = async settings => {
    return await runHttpsCallableFunction('saveBookingSettingsSecondGen', { settings })
}

const getPublicBookingApiBase = () => {
    const hostingUrl = getHostingUrl ? getHostingUrl().replace(/\/+$/, '') : ''
    if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin
    return hostingUrl
}

const parseJsonResponse = async response => {
    const payload = await response.json().catch(() => ({}))
    if (!response.ok || payload.success === false) {
        throw new Error(payload.error || payload.message || 'Booking request failed')
    }
    return payload
}

export const getPublicBookingPage = async slug => {
    const response = await fetch(`${getPublicBookingApiBase()}/api/booking/page/${encodeURIComponent(slug)}`)
    return await parseJsonResponse(response)
}

export const getPublicBookingSlots = async ({ slug, start, end, timeZone }) => {
    const params = new URLSearchParams({
        slug,
        start,
        end,
        timeZone,
    })
    const response = await fetch(`${getPublicBookingApiBase()}/api/booking/slots?${params.toString()}`)
    return await parseJsonResponse(response)
}

export const bookPublicMeeting = async payload => {
    const response = await fetch(`${getPublicBookingApiBase()}/api/booking/book`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    })
    return await parseJsonResponse(response)
}
