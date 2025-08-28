import { useEffect, useRef, useState } from 'react'
import moment from 'moment'

import store from '../redux/store'
import Backend from '../utils/BackendBridge'
import { getDateFormat } from '../components/UIComponents/FloatModals/DateFormatPickerModal'

const useLastEditDate = (lastEditDate, time = 1000) => {
    const tablet = store.getState().isMiddleScreen
    const [relativeDateText, setRelativeDateText] = useState('')
    const interval = useRef()

    const callback = async () => {
        const serverDate = await Backend.getFirebaseTimestampDirectly()
        if (serverDate) {
            let text = ''
            const today = moment(serverDate)
            const lastEdit = moment(lastEditDate)

            const secondsDiff = today.diff(lastEdit, 'seconds')
            if (secondsDiff < 60) {
                if (secondsDiff === 1) {
                    text = tablet ? '1 sec ago' : '1 second ago'
                }
                text = `${secondsDiff} ${tablet ? 'sec ago' : 'seconds ago'}`
            } else {
                const minutesDiff = today.diff(lastEdit, 'minutes')
                if (minutesDiff < 60) {
                    if (minutesDiff === 1) {
                        text = tablet ? '1 min ago' : '1 minute ago'
                    }
                    text = `${minutesDiff} ${tablet ? 'min ago' : 'minutes ago'}`
                } else {
                    const hoursDiff = today.diff(lastEdit, 'hours')
                    if (hoursDiff < 24) {
                        if (hoursDiff === 1) {
                            text = '1 hour ago'
                        }
                        text = `${hoursDiff} hours ago`
                    } else {
                        text = moment(lastEditDate).format(getDateFormat())
                    }
                }
            }

            setRelativeDateText(text)
        }
    }

    const cleanInterval = () => {
        if (interval.current != null) clearInterval(interval.current)
    }

    useEffect(() => {
        cleanInterval()
        interval.current = setInterval(callback, time)

        return () => cleanInterval()
    }, [lastEditDate])

    return relativeDateText
}

export default useLastEditDate
