import React, { useEffect, useState } from 'react'
import { StyleSheet } from 'react-native'
import { useDispatch } from 'react-redux'

import Button from '../UIControls/Button'
import AppPopover from '../UIComponents/ModalShell/AppPopover'
import WikiCorrectionForm from './WikiCorrectionForm'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import { centerPopoverInWindow } from '../../utils/popoverPositioning'
import { translate } from '../../i18n/TranslationService'

// "Give feedback" on a wiki page (AT-2874): a compact ghost button, the way secondary actions look
// elsewhere in the app, that opens the feedback form as a standard popup — centred on desktop,
// a bottom sheet on mobile (AppPopover owns that switch).
export default function WikiFeedbackButton({ projectId, page }) {
    const dispatch = useDispatch()
    const [isOpen, setIsOpen] = useState(false)

    const open = () => {
        setIsOpen(true)
        dispatch(showFloatPopup())
    }

    const close = () => {
        setIsOpen(false)
        dispatch(hideFloatPopup())
    }

    // Moving to another page while the popup is open must not leave it describing the old one,
    // nor leave the float-popup flag (which blocks shortcuts) set behind it.
    useEffect(() => {
        if (!isOpen) return
        return () => dispatch(hideFloatPopup())
    }, [isOpen, dispatch])
    useEffect(() => {
        setIsOpen(false)
    }, [page.slug])

    return (
        <AppPopover
            content={<WikiCorrectionForm projectId={projectId} page={page} onClose={close} />}
            isOpen={isOpen}
            onClickOutside={close}
            position={['top']}
            align={'center'}
            padding={4}
            contentLocation={args => centerPopoverInWindow(args)}
            disableReposition
        >
            <Button
                type={'ghost'}
                icon={'message-circle'}
                iconSize={16}
                iconGap={8}
                title={translate('Give feedback')}
                onPress={open}
                disabled={isOpen}
                buttonStyle={localStyles.button}
            />
        </AppPopover>
    )
}

const COMPACT_BUTTON_HEIGHT = 32

const localStyles = StyleSheet.create({
    button: {
        // Button's master style pins all three heights, so a compact button overrides all three.
        height: COMPACT_BUTTON_HEIGHT,
        minHeight: COMPACT_BUTTON_HEIGHT,
        maxHeight: COMPACT_BUTTON_HEIGHT,
        paddingVertical: 4,
        paddingLeft: 8,
        paddingRight: 12,
        marginVertical: 4,
    },
})
