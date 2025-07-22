import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Placeholder from './Placeholder'
import CreateContact from './Contacts/CreateContact'
import CreateTask from './Tasks/CreateTask'
import CreateNote from './Notes/CreateNote'
import CreateTopic from './Topics/CreateTopic'
import CreateGoal from './Goals/CreateGoal'
import {
    MENTION_MODAL_CONTACTS_TAB,
    MENTION_MODAL_GOALS_TAB,
    MENTION_MODAL_NOTES_TAB,
    MENTION_MODAL_TASKS_TAB,
    MENTION_MODAL_TOPICS_TAB,
} from '../Feeds/CommentsTextInput/textInputHelper'
import {
    COMMENT_MODAL_ID,
    exitsOpenModals,
    FOLLOW_UP_MODAL_ID,
    MANAGE_TASK_MODAL_ID,
    MENTION_MODAL_ID,
    TAGS_INTERACTION_MODAL_ID,
    TASK_DESCRIPTION_MODAL_ID,
    WORKFLOW_MODAL_ID,
} from '../ModalsManager/modalsManager'
import { useDispatch, useSelector } from 'react-redux'
import { setMentionModalNewFormOpen } from '../../redux/actions'

function NewObjectsInMentions(
    {
        activeTab,
        projectId,
        selectItemToMention,
        hover = true,
        selectNewForm,
        modalId,
        mentionText,
        containerStyle,
        delalyPrivacyModalClose,
    },
    ref
) {
    const mentionModalStack = useSelector(state => state.mentionModalStack)
    const dispatch = useDispatch()
    const [open, setOpen] = useState(false)

    const openForm = () => {
        setOpen(true)
        selectNewForm?.()
    }

    const closeForm = () => {
        setOpen(false)
    }

    useImperativeHandle(ref, () => ({
        open: () => {
            openForm()
        },
        close: () => {
            closeForm()
        },
        isOpen: () => {
            return open
        },
    }))

    const onKeyDown = e => {
        if (
            e.key === 'Escape' &&
            mentionModalStack[0] === modalId &&
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
            e?.preventDefault()
            e?.stopPropagation()
            closeForm()
        }
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    useEffect(() => {
        dispatch(setMentionModalNewFormOpen(open))
        return () => dispatch(setMentionModalNewFormOpen(false))
    }, [open])

    const renderComponentToCreateObject = () => {
        switch (activeTab) {
            case MENTION_MODAL_TASKS_TAB:
                return (
                    <CreateTask
                        projectId={projectId}
                        selectItemToMention={selectItemToMention}
                        modalId={modalId}
                        mentionText={mentionText}
                    />
                )
            case MENTION_MODAL_CONTACTS_TAB:
                return (
                    <CreateContact
                        projectId={projectId}
                        selectItemToMention={selectItemToMention}
                        modalId={modalId}
                        mentionText={mentionText}
                    />
                )
            case MENTION_MODAL_NOTES_TAB:
                return (
                    <CreateNote
                        projectId={projectId}
                        selectItemToMention={selectItemToMention}
                        modalId={modalId}
                        mentionText={mentionText}
                    />
                )
            case MENTION_MODAL_TOPICS_TAB:
                return (
                    <CreateTopic
                        projectId={projectId}
                        selectItemToMention={selectItemToMention}
                        modalId={modalId}
                        mentionText={mentionText}
                    />
                )
            case MENTION_MODAL_GOALS_TAB:
                return (
                    <CreateGoal
                        projectId={projectId}
                        selectItemToMention={selectItemToMention}
                        modalId={modalId}
                        mentionText={mentionText}
                        delalyPrivacyModalClose={delalyPrivacyModalClose}
                    />
                )
        }
    }

    return (
        <View style={[open && localStyles.container, containerStyle]}>
            {open ? (
                renderComponentToCreateObject()
            ) : (
                <Placeholder activeTab={activeTab} onPress={openForm} hover={hover} />
            )}
        </View>
    )
}

export default forwardRef(NewObjectsInMentions)

const localStyles = StyleSheet.create({
    container: {
        marginBottom: 16,
    },
})
