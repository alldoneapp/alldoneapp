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
import AppPopover from '../UIComponents/ModalShell/AppPopover'

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
    primary,
    // The empty-inbox call to action (AT-2306) is the same control at a bigger
    // size — sharing the component keeps one popup wiring (popover, float-popup
    // bookkeeping, mention-modal-aware close) instead of a second copy of it.
    large,
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

    // The large variant keeps its label at every width: it is the only call to
    // action on the screen it lives on, so shrinking it to a bare icon would
    // leave nothing to read.
    const showLabel = large || (!smallScreenNavigation && !forceShrink)

    const trigger = (
        <TouchableOpacity
            style={[
                localStyles.tag,
                primary && localStyles.tagPrimary,
                !large && (smallScreenNavigation || forceShrink) && localStyles.tagMobile,
                large && localStyles.tagLarge,
                style,
            ]}
            onPress={handleOpen}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={translate('Add task')}
            accessibilityState={{ disabled: !!disabled, expanded: isOpen }}
        >
            <View style={localStyles.icon}>
                <Icon name={'check-square'} size={large ? 20 : 16} color={primary ? '#ffffff' : colors.Text03} />
            </View>
            {showLabel && (
                <Text
                    style={[
                        large ? styles.subtitle1 : styles.subtitle2,
                        localStyles.text,
                        primary && localStyles.textPrimary,
                        large && localStyles.textLarge,
                        windowTagStyle(),
                    ]}
                >
                    {translate('Add task')}
                </Text>
            )}
        </TouchableOpacity>
    )

    return (
        <AppPopover
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
        </AppPopover>
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
    tagPrimary: {
        backgroundColor: colors.UtilityBlue200,
        borderColor: colors.UtilityBlue150,
    },
    tagMobile: {
        width: 24,
        height: 24,
    },
    tagLarge: {
        height: 44,
        paddingHorizontal: 20,
        alignSelf: 'center',
    },
    text: {
        color: colors.Text03,
        marginLeft: 6,
        marginRight: 4,
    },
    textPrimary: {
        color: '#ffffff',
    },
    textLarge: {
        marginLeft: 10,
        marginRight: 2,
    },
    icon: {
        flexDirection: 'row',
        alignSelf: 'center',
    },
})

export default withSafePopover(AddTaskTag)
