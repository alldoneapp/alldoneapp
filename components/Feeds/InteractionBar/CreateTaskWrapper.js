import React, { useRef, useState } from 'react'
import { View } from 'react-native'
import Popover from 'react-tiny-popover'
import RichCreateTaskModal from '../../UIComponents/FloatModals/RichCreateTaskModal/RichCreateTaskModal'
import Button from '../../UIControls/Button'
import Hotkeys from 'react-hot-keys'
import { execShortcutFn } from '../../../utils/HelperFunctions'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import { useDispatch, useSelector } from 'react-redux'
import { MENTION_MODAL_ID } from '../../ModalsManager/modalsManager'

export default function CreateTaskWrapper({
    projectId,
    subscribeClickObserver,
    unsubscribeClickObserver,
    sourceType,
    sourceId,
    existSource,
    style,
    smallScreen,
    setShowInteractionBar,
    disabled,
    source,
}) {
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const mobile = useSelector(state => state.smallScreenNavigation)
    const openModals = useSelector(state => state.openModals)
    const taskBtnRef = useRef()
    const [showModal, setShowModal] = useState(false)
    const dispatch = useDispatch()

    const openModal = () => {
        unsubscribeClickObserver()
        setShowModal(true)
        dispatch(showFloatPopup())
    }

    const closeModal = () => {
        if (!isQuillTagEditorOpen && !openModals[MENTION_MODAL_ID]) {
            subscribeClickObserver()
            setShowModal(false)
            dispatch(hideFloatPopup())
        }
    }

    return (
        <View>
            <Popover
                content={
                    <RichCreateTaskModal
                        initialProjectId={projectId}
                        sourceType={sourceType}
                        sourceId={sourceId}
                        existSource={existSource}
                        setShowInteractionBar={setShowInteractionBar}
                        closeModal={closeModal}
                        sourceIsPublicFor={source && source.isPublicFor}
                        lockKey={source && source.lockKey}
                    />
                }
                onClickOutside={closeModal}
                isOpen={showModal}
                position={['bottom', 'left', 'right', 'top']}
                padding={4}
                align={'end'}
                contentLocation={mobile ? null : undefined}
            >
                <Hotkeys
                    keyName={'alt+T'}
                    onKeyDown={(sht, event) => execShortcutFn(taskBtnRef.current, openModal, event)}
                    filter={e => true}
                    disabled={disabled}
                >
                    <Button
                        ref={taskBtnRef}
                        title={smallScreen ? null : 'Add task'}
                        type={'ghost'}
                        noBorder={smallScreen}
                        icon={'check-square'}
                        buttonStyle={style}
                        onPress={openModal}
                        shortcutText={'T'}
                        disabled={disabled}
                    />
                </Hotkeys>
            </Popover>
        </View>
    )
}
