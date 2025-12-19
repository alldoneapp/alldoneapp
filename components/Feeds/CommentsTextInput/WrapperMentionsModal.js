import React, { useEffect } from 'react'
import { View } from 'react-native'

import MentionsModal from './MentionsModal'
import Popover from 'react-tiny-popover'
import { useDispatch, useSelector } from 'react-redux'
import { hideFloatPopup, showFloatPopup } from '../../../redux/actions'
import {
    COMMENT_MODAL_ID,
    exitsOpenModals,
    FOLLOW_UP_MODAL_ID,
    MANAGE_TASK_MODAL_ID,
    MENTION_MODAL_ID,
    TAGS_INTERACTION_MODAL_ID,
    TASK_DESCRIPTION_MODAL_ID,
    WORKFLOW_MODAL_ID,
} from '../../ModalsManager/modalsManager'
import useWindowSize from '../../../utils/useWindowSize'
import { MENTION_MODAL_MIN_HEIGHT, MODAL_MAX_HEIGHT_GAP, popoverToCenter } from '../../../utils/HelperFunctions'

export default function WrapperMentionsModal({
    mentionText,
    selectItemToMention,
    projectId,
    contentLocation,
    setMentionModalHeight,
    keepFocus,
    inMentionsEditionTag,
    insertNormalMention,
}) {
    const [width, height] = useWindowSize()
    const maxHeight = height - contentLocation.top - MODAL_MAX_HEIGHT_GAP
    const finalLocation = maxHeight < MENTION_MODAL_MIN_HEIGHT ? null : contentLocation
    const mobile = useSelector(state => state.smallScreenNavigation)
    const dispatch = useDispatch()

    useEffect(() => {
        dispatch(showFloatPopup())
        return () => dispatch(hideFloatPopup())
    }, [])

    const onClickOutside = () => {
        if (
            !exitsOpenModals([
                MENTION_MODAL_ID,
                COMMENT_MODAL_ID,
                MANAGE_TASK_MODAL_ID,
                FOLLOW_UP_MODAL_ID,
                WORKFLOW_MODAL_ID,
                TASK_DESCRIPTION_MODAL_ID,
                TAGS_INTERACTION_MODAL_ID,
            ])
        ) {
            insertNormalMention()
        }
    }

    return (
        <Popover
            content={
                <MentionsModal
                    mentionText={mentionText}
                    selectItemToMention={selectItemToMention}
                    projectId={projectId}
                    setMentionModalHeight={setMentionModalHeight}
                    keepFocus={keepFocus}
                    inMentionsEditionTag={inMentionsEditionTag}
                    insertNormalMention={insertNormalMention}
                    contentLocation={finalLocation}
                />
            }
            isOpen={true}
            position={['top', 'right', 'bottom', 'left']}
            padding={4}
            align={'start'}
            onClickOutside={onClickOutside}
            contentLocation={finalLocation ? finalLocation : args => popoverToCenter(args, mobile)}
        >
            <View onClick={e => e.stopPropagation()} />
        </Popover>
    )
}
