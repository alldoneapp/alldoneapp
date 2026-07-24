import React, { useEffect } from 'react'
import { View } from 'react-native'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'

import AttachmentsSelectorModal from './AttachmentsSelectorModal'
import {
    ATTACHMENTS_SELECTOR_MODAL_ID,
    RECORD_SCREEN_MODAL_ID,
    RECORD_VIDEO_MODAL_ID,
} from '../../Feeds/CommentsTextInput/textInputHelper'
import { removeOpenModal } from '../../../redux/actions'

export default function NotesAttachmentsSelectorModal({ projectId, addAttachmentTag, space }) {
    const dispatch = useDispatch()
    const openModals = useSelector(state => state.openModals)

    const closeClickingOutside = () => {
        if (
            openModals[ATTACHMENTS_SELECTOR_MODAL_ID] &&
            !openModals[RECORD_VIDEO_MODAL_ID] &&
            !openModals[RECORD_SCREEN_MODAL_ID]
        ) {
            dispatch(removeOpenModal(ATTACHMENTS_SELECTOR_MODAL_ID))
        }
    }

    const closeModal = () => {
        if (openModals[ATTACHMENTS_SELECTOR_MODAL_ID]) {
            dispatch(removeOpenModal(ATTACHMENTS_SELECTOR_MODAL_ID))
        }
    }

    useEffect(() => {
        return () => {
            dispatch(removeOpenModal(ATTACHMENTS_SELECTOR_MODAL_ID))
        }
    }, [])

    return (
        <View style={{ marginTop: space != null ? space : 20 }}>
            {openModals[ATTACHMENTS_SELECTOR_MODAL_ID] && (
                <Popover
                    content={
                        <AttachmentsSelectorModal
                            projectId={projectId}
                            closeModal={closeModal}
                            addAttachmentTag={addAttachmentTag}
                        />
                    }
                    onClickOutside={closeClickingOutside}
                    isOpen={true}
                    position={['bottom', 'left', 'right', 'top']}
                    padding={4}
                    align={'start'}
                >
                    <View />
                </Popover>
            )}
        </View>
    )
}
