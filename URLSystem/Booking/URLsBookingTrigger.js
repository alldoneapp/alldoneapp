import { URL_NOT_MATCH } from '../URLSystemTrigger'
import NavigationService from '../../utils/NavigationService'

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
            const { slug } = matchedObj.matches.groups
            // The same booking URL is processed more than once on boot: the app routes it before
            // Firebase auth has even answered, and the auth callback (anonymous or logged in)
            // processes the initial URL again afterwards. Every navigate remounts the screen, so
            // without this guard the booking page would re-fetch its page and slots for nothing.
            const currentState = NavigationService.getCurrentState()
            if (
                currentState &&
                currentState.routeName === 'MeetingBooking' &&
                currentState.params &&
                currentState.params.slug === slug
            ) {
                return
            }
            return navigation.navigate('MeetingBooking', { slug })
        }
    }
}

export default URLsBookingTrigger
