import React, { useEffect, useState } from 'react'
import { useDispatch } from 'react-redux'

import { FEED_TASK_OBJECT_TYPE } from '../../../../Feeds/Utils/FeedsConstants'
import { hideFloatPopup, resetFloatPopup, showFloatPopup } from '../../../../../redux/actions'
import RichCreateTaskModal from '../../../../UIComponents/FloatModals/RichCreateTaskModal/RichCreateTaskModal'
import RunOutOfGoldAssistantModal from '../../../../ChatsView/ChatDV/EditorView/BotOption/RunOutOfGoldAssistantModal'
import PreConfigTaskGeneratorModal from '../../../../UIComponents/FloatModals/PreConfigTaskGeneratorModal/PreConfigTaskGeneratorModal'
import MainModal from './MainModal'

export default function MoreOptionsModal({ closeModal, options, projectId, assistant }) {
    const dispatch = useDispatch()
    const [showPreConfigTask, setShowPreConfigTask] = useState({ visible: false, task: null })
    const [runOutOfGold, setRunOutOfGold] = useState(false)

    const openPreconfigTaskModal = task => {
        setShowPreConfigTask({ visible: true, task })
        dispatch(showFloatPopup())
    }

    const closePreconfigTaskModal = () => {
        setShowPreConfigTask({ visible: false, task: null })
        dispatch(hideFloatPopup())
    }

    const openOutOfGoldModal = () => {
        setRunOutOfGold(true)
        dispatch(showFloatPopup())
    }

    const closeOutOfGoldModal = () => {
        setRunOutOfGold(false)
        dispatch(hideFloatPopup())
    }

    useEffect(() => {
        return () => {
            dispatch(resetFloatPopup())
        }
    }, [])

    return runOutOfGold ? (
        <RunOutOfGoldAssistantModal closeModal={closeOutOfGoldModal} />
    ) : showPreConfigTask.visible ? (
        <PreConfigTaskGeneratorModal
            projectId={projectId}
            closeModal={closePreconfigTaskModal}
            task={showPreConfigTask.task}
            assistant={assistant}
        />
    ) : (
        <MainModal
            closeModal={closeModal}
            options={options}
            openPreconfigTaskModal={openPreconfigTaskModal}
            openOutOfGoldModal={openOutOfGoldModal}
        />
    )
}
