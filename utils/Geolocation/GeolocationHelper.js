import { ApiError, ClientError, IpregistryClient } from '@ipregistry/client'
import { find, method } from 'lodash'

import dateFormatsByCountry from './date_formats_by_country.json'
import {
    DATE_FORMAT_EUROPE,
    MONDAY_FIRST_IN_CALENDAR,
    SUNDAY_FIRST_IN_CALENDAR,
} from '../../components/UIComponents/FloatModals/DateFormatPickerModal'
import { getIpRegistryVariables } from '../backends/firestore'

let client

export const initIpRegistry = () => {
    const { IP_REGISTRY_API_KEY } = getIpRegistryVariables()
    client = new IpregistryClient(IP_REGISTRY_API_KEY)
}

const getCurrentLocationInfo = async () => {
    try {
        const response = await client.lookup()
        return response.data.location
    } catch (error) {
        if (error instanceof ApiError) {
            console.error('API error', error)
        } else if (error instanceof ClientError) {
            console.error('Client error', error)
        } else {
            console.error('Unexpected error', error)
        }
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
