import React, { useEffect, useState } from 'react'
import GhostButton from '../../../UIControls/GhostButton'
import { useDispatch, useSelector } from 'react-redux'
import Popover from 'react-tiny-popover'
import { hideFloatPopup, showFloatPopup } from '../../../../redux/actions'
import SelectStickynessPopup from './SelectStickynessPopup'
import { translate } from '../../../../i18n/TranslationService'

export default function StickynessPicker({ projectId, note, disabled, isChat }) {
    const dispatch = useDispatch()
    const [visiblePopover, setVisiblePopover] = useState(false)
    const [selectedSticky, setSelectedSticky] = useState(parseDays(note.stickyData.days))
    const smallScreen = useSelector(state => state.smallScreen)

    const hidePopover = () => {
        setVisiblePopover(false)
        dispatch(hideFloatPopup())
    }

    const showPopover = () => {
        setVisiblePopover(true)
        dispatch(showFloatPopup())
    }

    useEffect(() => {
        setSelectedSticky(parseDays(note.stickyData.days))
    }, [note])

    return (
        <Popover
            content={
                <SelectStickynessPopup projectId={projectId} note={note} hidePopover={hidePopover} isChat={isChat} />
            }
            onClickOutside={hidePopover}
            isOpen={visiblePopover}
            position={['bottom', 'left', 'right', 'top']}
            padding={4}
            align={'end'}
            contentLocation={smallScreen ? null : undefined}
        >
            <GhostButton type={'ghost'} title={selectedSticky} onPress={showPopover} disabled={disabled} />
        </Popover>
    )
}

const parseDays = days => {
    if (days >= 365) {
        return translate('Forever')
    } else if (days === 0) {
        return translate('Unsticked')
    } else if (days > 1) {
        return translate(`Amount Days`, { amount: days })
    } else {
        return translate('1 Day')
    }
}
