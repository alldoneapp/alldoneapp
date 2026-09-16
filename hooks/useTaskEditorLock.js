import { useEffect, useRef } from 'react'
import { useDispatch } from 'react-redux'

import { finishTaskEditor, startTaskEditor } from '../redux/actions'

export const createTaskEditorLock = dispatch => {
    let acquired = false

    return {
        acquire: () => {
            if (acquired) return
            acquired = true
            dispatch(startTaskEditor())
        },
        release: () => {
            if (!acquired) return
            acquired = false
            dispatch(finishTaskEditor())
        },
        isAcquired: () => acquired,
    }
}

export default function useTaskEditorLock(active = false) {
    const dispatch = useDispatch()
    const lockRef = useRef()

    if (!lockRef.current) lockRef.current = createTaskEditorLock(dispatch)

    useEffect(() => {
        if (active) lockRef.current.acquire()
        return () => lockRef.current.release()
    }, [active])

    return lockRef.current
}
