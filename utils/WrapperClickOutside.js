import React, { useEffect, useRef } from 'react'

export default function WrapperClickOutside({ children, disabled = false, callback }) {
    const container = useRef(null)

    useEffect(() => {
        const handleClickOutside = event => {
            if (!disabled && container?.current && !container?.current?.contains(event.target)) {
                callback?.()
            }
        }

        // Bind the event listener
        document.addEventListener('mousedown', handleClickOutside)
        return () => {
            // Unbind the event listener on clean up
            document.removeEventListener('mousedown', handleClickOutside)
        }
    })

    return <div ref={container}>{children}</div>
}
