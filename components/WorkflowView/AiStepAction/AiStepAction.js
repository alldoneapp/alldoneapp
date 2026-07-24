import React, { useRef, useState } from 'react'
import { View } from 'react-native'
import Popover from 'react-tiny-popover'
import Hotkeys from 'react-hot-keys'
import { useDispatch, useSelector } from 'react-redux'

import AiStepActionModal from './AiStepActionModal'
import Button from '../../UIControls/Button'
import { hideFloatPopup, setWorkflowStep, showFloatPopup } from '../../../redux/actions'
import { execShortcutFn } from '../../../utils/HelperFunctions'
import { translate } from '../../../i18n/TranslationService'

/**
 * Shown in EditStep only while the step's reviewer is an assistant. Opens the picker for what the
 * assistant should run, and writes the result back onto the redux `workflowStep` draft.
 */
export default function AiStepAction({ projectId, onChangeValue }) {
    const [visiblePopover, setVisiblePopover] = useState(false)
    const smallScreen = useSelector(state => state.smallScreen)
    const step = useSelector(state => state.workflowStep)
    const dispatch = useDispatch()
    const buttonRef = useRef()

    const showPopover = () => {
        setVisiblePopover(true)
        dispatch(showFloatPopup())
        buttonRef?.current?.blur()
    }

    const closeModalByClickOutside = () => {
        setVisiblePopover(false)
        dispatch(hideFloatPopup())
    }

    const closeModal = () => {
        // Matches SendTo: deferring lets the originating click finish before the dismiss handlers of
        // the surrounding EditStep see it.
        setTimeout(() => {
            setVisiblePopover(false)
            dispatch(hideFloatPopup())
            if (onChangeValue !== undefined) onChangeValue()
        })
    }

    const onChange = aiFields => {
        dispatch(setWorkflowStep({ ...step, ...aiFields }))
    }

    return (
        <View style={{ marginRight: smallScreen ? 8 : 4 }}>
            <Popover
                content={
                    <AiStepActionModal
                        projectId={projectId}
                        assistantId={step.reviewerUid}
                        step={step}
                        onChange={onChange}
                        closeModal={closeModal}
                    />
                }
                onClickOutside={closeModalByClickOutside}
                isOpen={visiblePopover}
                position={['bottom', 'left', 'right', 'top']}
                padding={4}
                align={'end'}
                contentLocation={smallScreen ? null : undefined}
            >
                <Hotkeys
                    keyName={'alt+P'}
                    onKeyDown={(sht, event) => execShortcutFn(buttonRef.current, showPopover, event)}
                    filter={e => true}
                >
                    <Button
                        ref={buttonRef}
                        type={'ghost'}
                        icon={'zap'}
                        title={step.aiActionName || translate('Select action')}
                        onPress={showPopover}
                        shortcutText={'P'}
                    />
                </Hotkeys>
            </Popover>
        </View>
    )
}
