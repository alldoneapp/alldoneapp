import React, { useRef } from 'react'
import Button from '../../../../UIControls/Button'

export default function MoreButton({ onPress, buttonStyle, disabled }) {
    const btnRef = useRef()

    return (
        <Button
            ref={btnRef}
            type={'ghost'}
            icon={'more-vertical'}
            buttonStyle={buttonStyle}
            noBorder={true}
            onPress={onPress}
            accessible={false}
            disabled={disabled}
            iconSize={20}
        />
    )
}
