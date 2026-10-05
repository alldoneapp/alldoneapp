import { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'

import Backend from '../utils/BackendBridge'
import { getDateFormat } from '../components/UIComponents/FloatModals/DateFormatPickerModal'
import { formatLastEditDate } from '../i18n/relativeTime'

const useLastEditDate = (lastEditDate, time = 1000, compact = false) => {
    const tablet = useSelector(state => state.isMiddleScreen)
    const language = useSelector(state => state.loggedUser?.language)
    const dateFormat = useSelector(state => state.dateFormat)
    const [relativeDateText, setRelativeDateText] = useState('')

    useEffect(() => {
        let active = true
        const callback = async () => {
            const serverDate = await Backend.getFirebaseTimestampDirectly()
            if (active && serverDate) {
                setRelativeDateText(
                    formatLastEditDate(serverDate, lastEditDate, { compact, tablet, dateFormat: getDateFormat() })
                )
            }
        }

        callback()
        const interval = setInterval(callback, time)
        return () => {
            active = false
            clearInterval(interval)
        }
    }, [lastEditDate, time, compact, tablet, language, dateFormat])

    return relativeDateText
}

export default useLastEditDate
