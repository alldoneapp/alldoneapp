import React, { useLayoutEffect, useState } from 'react'

export default function useWindowSize() {
    const [size, setSize] = useState([0, 0])
    useLayoutEffect(() => {
        const updateSize = () => {
            setSize([window.innerWidth, window.innerHeight])
        }
        window.addEventListener('resize', updateSize)
        updateSize()

        return () => window.removeEventListener('resize', updateSize)
    }, [])

    return size
}

export function withWindowSizeHook(Component) {
    return function WrappedComponent(props) {
        const windowSize = useWindowSize()
        return <Component {...props} windowSize={windowSize} />
    }
}
