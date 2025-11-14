import { find, method } from 'lodash'
import firebase from '../../apis/firebase'

import dateFormatsByCountry from './date_formats_by_country.json'
import {
    DATE_FORMAT_EUROPE,
    MONDAY_FIRST_IN_CALENDAR,
    SUNDAY_FIRST_IN_CALENDAR,
} from '../../components/UIComponents/FloatModals/DateFormatPickerModal'

const functions = firebase.functions()

export const initIpRegistry = () => {
    // No longer needed - using cloud function
    console.log('IP Registry now uses cloud function')
}

const getCurrentLocationInfo = async () => {
    try {
        const ipLookupFn = functions.httpsCallable('ipRegistryLookup')
        const result = await ipLookupFn({})

        if (result.data.success && result.data.location) {
            return result.data.location
        }

        console.warn('IP Registry lookup failed, using default')
    } catch (error) {
        console.error('IP Registry cloud function error:', error)
    }

    return { country: { name: 'Germany' } }
}

const getDateFormatByCountry = async () => {
    const { country } = await getCurrentLocationInfo()
    const countryName = country.name

    let dateFormat = dateFormatsByCountry[countryName]

    if (!dateFormat) {
        const foundCountryName = find(Object.keys(dateFormatsByCountry), method('includes', countryName))
        dateFormat = foundCountryName ? dateFormatsByCountry[foundCountryName] : DATE_FORMAT_EUROPE
    }

    return dateFormat
}

export const getDateFormatFromCurrentLocation = async () => {
    const dateFormat = await getDateFormatByCountry()
    const mondayFirstInCalendar =
        dateFormat === DATE_FORMAT_EUROPE ? MONDAY_FIRST_IN_CALENDAR : SUNDAY_FIRST_IN_CALENDAR

    return { dateFormat, mondayFirstInCalendar }
}
