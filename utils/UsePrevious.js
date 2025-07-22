import { useEffect, useRef } from 'react'

export function usePrevious(value, initialValue) {
    const ref = useRef(initialValue)
    useEffect(() => {
        ref.current = value
    })
    return ref.current
}
