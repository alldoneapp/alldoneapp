import React, { useState, useEffect, useCallback, useRef } from 'react'
import Popover from 'react-tiny-popover'

/**
 * A Higher Order Component that wraps Popover components to prevent memory leaks
 * by properly handling unmounting and state updates.
 *
 * @param {React.ComponentType} WrappedComponent - The component to wrap
 * @returns {React.ComponentType} - The wrapped component with safe Popover handling
 */
export const withSafePopover = WrappedComponent => {
    return function SafePopoverWrapper(props) {
        const [isOpen, setIsOpen] = useState(false)
        const isUnmountedRef = useRef(false)

        useEffect(() => {
            return () => {
                isUnmountedRef.current = true
            }
        }, [])

        const openPopover = useCallback(() => {
            if (!isUnmountedRef.current) {
                setIsOpen(true)
            }
        }, [])

        const closePopover = useCallback(() => {
            if (!isUnmountedRef.current) {
                setIsOpen(false)
            }
        }, [])

        return <WrappedComponent {...props} openPopover={openPopover} closePopover={closePopover} isOpen={isOpen} />
    }
}

export default withSafePopover
