import React, { useState } from 'react'
import Popover from 'react-tiny-popover'
import Hotkeys from 'react-hot-keys'

import { colors } from '../../../styles/global'
import Button from '../../../UIControls/Button'
import RichCommentModal from '../RichCommentModal/RichCommentModal'
import { execShortcutFn } from '../../ShortcutCheatSheet/HelperFunctions'

export default function CommentWrapper({ task, projectId, setComment }) {
    const [isOpen, setIsOpen] = useState(false)

    const openModal = () => {
        setIsOpen(true)
    }

    const closeModal = () => {
        setIsOpen(false)
    }

    const addComment = (newComment, mentions, isPrivate, hasKarma) => {
        closeModal()
        setComment(newComment, isPrivate, hasKarma)
    }

    const cleanedName = task.extendedName.trim()

    return (
        <Popover
            content={
                <RichCommentModal
                    processDone={addComment}
                    closeModal={closeModal}
                    projectId={projectId}
                    objectType={'tasks'}
                    objectId={task.id}
                    currentComment={''}
                    currentPrivacy={false}
                    currentKarma={false}
                    userGettingKarmaId={task.userId}
                    inTaskModal={true}
                    externalAssistantId={task.assistantId}
                    objectName={task.name}
                />
            }
            align={'start'}
            position={['bottom']}
            onClickOutside={closeModal}
            isOpen={isOpen}
        >
            <Hotkeys
                keyName={'alt+c'}
                onKeyDown={(sht, event) => execShortcutFn(this.commentBtnRef, openModal, event)}
                filter={e => true}
                disabled={!cleanedName}
            >
                <Button
                    ref={ref => (this.commentBtnRef = ref)}
                    icon={'message-circle'}
                    iconColor={colors.Text04}
                    buttonStyle={{ backgroundColor: 'transparent', marginRight: 4 }}
                    onPress={openModal}
                    shortcutText={'C'}
                    forceShowShortcut={true}
                    disabled={!cleanedName}
                />
            </Hotkeys>
        </Popover>
    )
}
