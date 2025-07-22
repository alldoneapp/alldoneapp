import { useEffect } from 'react'

export default function useTextChange(text, onTextEndChange, timeToEndChange) {
    useEffect(() => {
        const intervalId = setInterval(() => {
            clearInterval(intervalId)
            onTextEndChange()
        }, timeToEndChange)
        return () => {
            clearInterval(intervalId)
        }
    }, [text])

    return null
}
