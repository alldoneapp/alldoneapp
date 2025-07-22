import React, { useRef } from 'react'
import Button from '../../../../UIControls/Button'
import Hotkeys from 'react-hot-keys'
import { useSelector } from 'react-redux'
import { execShortcutFn } from '../../../../../utils/HelperFunctions'

export default function MoreButton({
    iconColor,
    noBorder,
    onPress,
    buttonStyle,
    disabled,
    inMentionModal,
    shortcut = 'M',
    iconSize,
}) {
    const smallScreen = useSelector(state => state.smallScreen)
    const btnRef = useRef()

    return (
        <Hotkeys
            keyName={`alt+${shortcut}`}
            disabled={disabled}
            onKeyDown={(sht, event) => execShortcutFn(btnRef.current, onPress, event)}
            filter={e => true}
        >
            <Button
                ref={btnRef}
                type={'ghost'}
                icon={'more-vertical'}
                buttonStyle={buttonStyle}
                noBorder={noBorder || inMentionModal || smallScreen}
                onPress={onPress}
                accessible={false}
                shortcutText={shortcut}
                disabled={disabled}
                iconColor={iconColor}
                iconSize={iconSize}
            />
        </Hotkeys>
    )
}
