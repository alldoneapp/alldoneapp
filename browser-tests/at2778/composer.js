import React, { forwardRef, useImperativeHandle } from 'react'
export default forwardRef(function Composer(props, ref) {
    useImperativeHandle(ref, () => ({ focus() {}, getPane: () => null, clear() {} }), [])
    return <textarea defaultValue="Keep this draft" />
})
