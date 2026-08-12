import { URL_NOT_MATCH } from '../URLSystemTrigger'

export const URL_BOOKING_MEET = 'BOOKING_MEET'

class URLsBookingTrigger {
    static getRegexList = () => {
        return {
            [URL_BOOKING_MEET]: new RegExp('^/meet/(?<slug>[a-zA-Z0-9-]+)$'),
        }
    }

    static match = pathname => {
        const regexList = URLsBookingTrigger.getRegexList()
        for (let key in regexList) {
            const matchObj = pathname.match(regexList[key])
            if (matchObj) return { key, matches: matchObj }
        }
        return URL_NOT_MATCH
    }

    static trigger = (navigation, pathname) => {
        const matchedObj = URLsBookingTrigger.match(pathname)
        if (matchedObj.key === URL_BOOKING_MEET) {
            return navigation.navigate('MeetingBooking', { slug: matchedObj.matches.groups.slug })
        }
    }
}

export default URLsBookingTrigger
