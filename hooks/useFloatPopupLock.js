import { useEffect, useRef } from 'react'
import { useDispatch } from 'react-redux'

import { hideFloatPopup, showFloatPopup } from '../redux/actions'

export const createFloatPopupLock = dispatch => {
    let acquired = false

    // The main list uses the global popup count as a scroll lock in every compact
    // content layout, including phone, tablet, and narrower desktop windows.
    // Keep each owner's contribution idempotent so an unmount can safely release it.
    return {
        acquire: () => {
            if (acquired) return
            acquired = true
            dispatch(showFloatPopup())
        },
        release: () => {
            if (!acquired) return
            acquired = false
            dispatch(hideFloatPopup())
        },
        isAcquired: () => acquired,
    }
}

export default function useFloatPopupLock() {
    const dispatch = useDispatch()
    const lockRef = useRef()

    if (!lockRef.current) {
        lockRef.current = createFloatPopupLock(dispatch)
    }

    useEffect(() => {
        return () => lockRef.current.release()
    }, [])

    return lockRef.current
}
