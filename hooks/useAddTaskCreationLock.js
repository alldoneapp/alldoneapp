import { useEffect, useRef } from 'react'
import { useDispatch } from 'react-redux'

import { finishAddTaskCreation, startAddTaskCreation } from '../redux/actions'

export const createAddTaskCreationLock = dispatch => {
    let acquired = false

    return {
        acquire: () => {
            if (acquired) return
            acquired = true
            dispatch(startAddTaskCreation())
        },
        release: () => {
            if (!acquired) return
            acquired = false
            dispatch(finishAddTaskCreation())
        },
        isAcquired: () => acquired,
    }
}

export default function useAddTaskCreationLock() {
    const dispatch = useDispatch()
    const lockRef = useRef()

    if (!lockRef.current) lockRef.current = createAddTaskCreationLock(dispatch)

    useEffect(() => () => lockRef.current.release(), [])

    return lockRef.current
}
