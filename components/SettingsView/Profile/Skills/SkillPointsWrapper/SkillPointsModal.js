import React, { useState, useRef, useEffect } from 'react'
import { StyleSheet, View } from 'react-native'

import { colors } from '../../../../styles/global'
import ModalHeader from '../../../../UIComponents/FloatModals/ModalHeader'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../../utils/HelperFunctions'
import useWindowSize from '../../../../../utils/useWindowSize'
import Line from '../../../../UIComponents/FloatModals/GoalMilestoneModal/Line'
import CustomScrollView from '../../../../UIControls/CustomScrollView'
import CommentInfo from '../../../../UIComponents/FloatModals/GoalsProgressModal/CommentInfo'
import EditForm from '../../../../UIComponents/FloatModals/RichCommentModal/EditForm'
import AttachmentsSelectorModal from '../../../../UIComponents/FloatModals/AttachmentsSelectorModal'
import { insertAttachmentInsideEditor } from '../../../../Feeds/CommentsTextInput/textInputHelper'
import { translate } from '../../../../../i18n/TranslationService'
import { checkIsLimitedByTraffic } from '../../../../Premium/PremiumHelper'
import PointsStatistics from './PointsStatistics'
import IncDecButtons from './IncDecButtons'

export default function SkillPointsModal({ projectId, skillId, points, changeSkillPoints, closeModal }) {
    const [showFileSelector, setShowFileSelector] = useState(false)
    const [inputCursorIndex, setInputCursorIndex] = useState(0)
    const [editor, setEditor] = useState(null)
    const [initialComment, setInitialComment] = useState('')

    const editForm = useRef(null)
    const editorOpsRef = useRef([])

    const [width, height] = useWindowSize()

    useEffect(() => {
        editForm.current.blur()
    }, [])

    const toggleShowFileSelector = () => {
        if (showFileSelector || !checkIsLimitedByTraffic(projectId)) {
            const newValue = !showFileSelector
            setShowFileSelector(newValue)
            if (newValue) editorOpsRef.current = []
        } else {
            closeModal()
        }
    }

    const addAttachmentTag = (text, uri) => {
        insertAttachmentInsideEditor(inputCursorIndex, editor, text, uri)
        const ops = editor.getContents().ops
        editorOpsRef.current = ops
        setInputCursorIndex(inputCursorIndex + 3)
    }

    return (
        <View>
            {showFileSelector ? (
                <AttachmentsSelectorModal
                    closeModal={toggleShowFileSelector}
                    addAttachmentTag={addAttachmentTag}
                    projectId={projectId}
                />
            ) : (
                <View
                    style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}
                >
                    <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                        <ModalHeader
                            closeModal={closeModal}
                            title={translate('Skill points status')}
                            description={translate('Reduce or increase skill points')}
                        />
                        <PointsStatistics points={points} />
                        <Line style={localStyles.line} />
                        <CommentInfo />
                        <EditForm
                            ref={editForm}
                            projectId={projectId}
                            containerStyle={localStyles.editorContainer}
                            currentComment={initialComment}
                            toggleShowFileSelector={toggleShowFileSelector}
                            setEditor={setEditor}
                            editor={editor}
                            setInputCursorIndex={setInputCursorIndex}
                            initialCursorIndex={inputCursorIndex}
                            initialDeltaOps={editorOpsRef.current.length > 0 ? editorOpsRef.current : null}
                            setInitialComment={setInitialComment}
                            objectType="skills"
                            hideDoneButton={true}
                            objectId={skillId}
                        />
                        <Line style={localStyles.line} />
                        <IncDecButtons
                            projectId={projectId}
                            skillId={skillId}
                            points={points}
                            changeSkillPoints={changeSkillPoints}
                            initialComment={initialComment}
                        />
                    </CustomScrollView>
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        padding: 16,
    },
    line: {
        marginTop: 16,
    },
    editorContainer: {
        marginBottom: 0,
        marginTop: 8,
        marginHorizontal: -8,
    },
})
