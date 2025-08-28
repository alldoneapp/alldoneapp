import React from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'
import styles, { colors, windowTagStyle } from '../styles/global'
import Icon from '../Icon'
import { hideFloatPopup, showFloatPopup } from '../../redux/actions'
import RichCreateTaskModal from '../UIComponents/FloatModals/RichCreateTaskModal/RichCreateTaskModal'
import { MENTION_MODAL_ID } from '../ModalsManager/modalsManager'
import { translate } from '../../i18n/TranslationService'
import withSafePopover from '../UIComponents/HOC/withSafePopover'
import Popover from 'react-tiny-popover'

function AddTaskTag({
    projectId,
    objectId,
    style,
    sourceIsPublicFor,
    lockKey,
    setPressedShowMoreMainSection,
    sourceType,
    tryExpandTasksListInGoalWhenAddTask,
    useLoggedUser,
    disabled,
    showProjectSelector,
    forceShrink,
    expandTaskListIfNeeded,
    openPopover,
    closePopover,
    isOpen,
}) {
    const dispatch = useDispatch()
    const isQuillTagEditorOpen = useSelector(state => state.isQuillTagEditorOpen)
    const openModals = useSelector(state => state.openModals)
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)

    const handleOpen = () => {
        openPopover()
        dispatch(showFloatPopup())
    }

    const handleClose = () => {
        if (!isQuillTagEditorOpen && !openModals[MENTION_MODAL_ID]) {
            closePopover()
            dispatch(hideFloatPopup())
        }
    }

    const trigger = (
        <TouchableOpacity
            style={[localStyles.tag, (smallScreenNavigation || forceShrink) && localStyles.tagMobile, style]}
            onPress={handleOpen}
            disabled={disabled}
        >
            <View style={localStyles.icon}>
                <Icon name={'check-square'} size={16} color={colors.Text03} />
            </View>
            {!smallScreenNavigation && !forceShrink && (
                <Text style={[styles.subtitle2, localStyles.text, windowTagStyle()]}>{translate('Add task')}</Text>
            )}
        </TouchableOpacity>
    )

    return (
        <Popover
            isOpen={isOpen}
            positions={['bottom', 'top', 'left', 'right']}
            align="start"
            containerStyle={{ zIndex: 9999 }}
            padding={8}
            offsetY={5}
            onClickOutside={handleClose}
            content={
                <div
                    style={{
                        position: 'relative',
                        backgroundColor: 'var(--background-primary)',
                        borderRadius: '8px',
                        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
                        minWidth: '300px',
                    }}
                >
                    <RichCreateTaskModal
                        initialProjectId={projectId}
                        sourceType={sourceType}
                        sourceId={objectId}
                        closeModal={handleClose}
                        sourceIsPublicFor={sourceIsPublicFor}
                        lockKey={lockKey}
                        fromTaskList={true}
                        useLoggedUser={useLoggedUser}
                        setPressedShowMoreMainSection={setPressedShowMoreMainSection}
                        tryExpandTasksListInGoalWhenAddTask={tryExpandTasksListInGoalWhenAddTask}
                        showProjectSelector={showProjectSelector}
                        expandTaskListIfNeeded={expandTaskListIfNeeded}
                    />
                </div>
            }
        >
            {trigger}
        </Popover>
    )
}

const localStyles = StyleSheet.create({
    tag: {
        flexDirection: 'row',
        borderRadius: 50,
        justifyContent: 'center',
        alignItems: 'center',
        height: 24,
        alignSelf: 'flex-start',
        borderWidth: 1,
        borderColor: colors.Text03,
        paddingHorizontal: 4,
    },
    tagMobile: {
        width: 24,
        height: 24,
    },
    text: {
        color: colors.Text03,
        marginLeft: 6,
        marginRight: 4,
    },
    icon: {
        flexDirection: 'row',
        alignSelf: 'center',
    },
})

export default withSafePopover(AddTaskTag)
