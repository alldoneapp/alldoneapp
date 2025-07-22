import React, { forwardRef, useEffect, useState } from 'react'
import { StyleSheet } from 'react-native'
import * as PropTypes from 'prop-types'
import Button from './Button'
import { colors } from '../styles/global'

function GhostButton({ pressed, ...props }, ref) {
    const [titleStyle, setTitleStyle] = useState(props.titleStyle)
    const [noBorder, setNoBorder] = useState(true)

    useEffect(() => {
        setTitleStyle(pressed ? { ...props.titleStyle, color: colors.Text01 } : props.titleStyle)
        setNoBorder(
            pressed
                ? (props.icon == null && props.title != null) || (props.icon != null && props.title == null)
                : props.noBorder
        )
    }, [pressed, props.icon, props.noBorder, props.title, props.titleStyle])

    return (
        <Button
            {...props}
            ref={ref}
            noBorder={noBorder}
            titleStyle={titleStyle}
            buttonStyle={[
                props.buttonStyle,
                pressed &&
                    (props.icon != null && props.title != null
                        ? localStyles.pressedComplete
                        : localStyles.pressedSimple),
            ]}
        />
    )
}

GhostButton.propTypes = {
    pressed: PropTypes.bool,
}

GhostButton.defaultProps = {
    pressed: false,
}

const localStyles = StyleSheet.create({
    // Master button styles
    pressedSimple: {
        backgroundColor: 'transparent',
    },
    pressedComplete: {
        backgroundColor: 'transparent',
        borderColor: colors.Text01,
    },
})

export default forwardRef(GhostButton)
