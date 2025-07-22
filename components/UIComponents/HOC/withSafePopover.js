import React, { useState, useEffect, useCallback } from 'react'
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
        const [isUnmounted, setIsUnmounted] = useState(false)

        useEffect(() => {
            return () => {
                setIsUnmounted(true)
                setIsOpen(false)
            }
        }, [])

        const openPopover = useCallback(() => {
            if (!isUnmounted) {
                setIsOpen(true)
            }
        }, [isUnmounted])

        const closePopover = useCallback(() => {
            if (!isUnmounted) {
                setIsOpen(false)
            }
        }, [isUnmounted])

        return <WrappedComponent {...props} openPopover={openPopover} closePopover={closePopover} isOpen={isOpen} />
    }
}

export default withSafePopover
