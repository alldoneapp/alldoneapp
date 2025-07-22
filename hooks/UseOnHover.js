import React, { useEffect, useState } from 'react'

export default function useOnHover(initialValue, selected = false) {
    const [hover, setHover] = useState(initialValue != null ? initialValue : false)

    useEffect(() => {
        // When someone change user in sidebar
        // the "initialValue" of the previous selected user change to FALSE.
        // As that parameter was TRUE before, if we don't update the "hover" when update the "initialValue"
        // then "hover" will remain selected (TRUE)
        setHover(initialValue != null ? initialValue : hover)
    }, [initialValue])

    const onHover = _e => {
        !hover && !selected && setHover(true)
    }

    const offHover = _e => {
        hover && !selected && setHover(false)
    }

    return { hover, onHover, offHover }
}
