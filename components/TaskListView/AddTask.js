import React, { useRef } from 'react'
import { StyleSheet, TouchableOpacity, View } from 'react-native'
import { useDispatch, useSelector } from 'react-redux'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import { setAddTaskRepeatMode } from '../../redux/actions'
import SocialText from '../UIControls/SocialText/SocialText'
import Shortcut from '../UIControls/Shortcut'
import SharedHelper from '../../utils/SharedHelper'
import WrapperTaskParentGoalModal from '../UIComponents/FloatModals/TaskParentGoalModal/WrapperTaskParentGoalModal'
import { translate } from '../../i18n/TranslationService'

function AddTask({
    isSubtask,
    projectId,
    newItem,
    toggleModal,
    activeGoal,
    hideParentGoalButton,
    isLocked,
    dateFormated,
}) {
    const dispatch = useDispatch()
    const showShortcuts = useSelector(state => state.showShortcuts)
    const loggedUser = useSelector(state => state.loggedUser)
    const currentUser = useSelector(state => state.currentUser)
    const taskItem = useRef()

    const onCheckboxPress = () => {
        toggleModal()
        dispatch(setAddTaskRepeatMode())
    }

    const accessGranted = SharedHelper.accessGranted(loggedUser, projectId)

    return (
        <View ref={taskItem} style={localStyles.container}>
            <View style={{ borderRadius: 4 }}>
                <View
                    style={[
                        localStyles.taskRow,
                        isSubtask ? subTaskStyles.taskRow : undefined,
                        isSubtask && newItem ? { paddingLeft: 2 } : undefined,
                        { backgroundColor: isSubtask ? colors.Grey200 : '#ffffff' },
                    ]}
                >
                    <View style={[localStyles.checkBoxLabel]}>
                        <TouchableOpacity
                            style={[localStyles.checkBox, isSubtask && subTaskStyles.checkBox]}
                            accessible={false}
                            activeOpacity={0.35}
                            onPress={onCheckboxPress}
                            onLongPress={onCheckboxPress}
                            disabled={!accessGranted}
                        >
                            <Icon name={'plus-square'} size={24} color={colors.Primary100} />
                        </TouchableOpacity>

                        <View
                            style={[
                                localStyles.descriptionContainer,
                                isSubtask && newItem ? subTaskStyles.descriptionContainer : undefined,
                            ]}
                        >
                            <SocialText
                                elementId={`social_text_${projectId}`}
                                style={[
                                    isSubtask ? styles.body2 : styles.body1,
                                    localStyles.descriptionText,
                                    newItem ? localStyles.newItemPlaceholderText : undefined,
                                    isSubtask ? subTaskStyles.descriptionText : undefined,
                                    isSubtask ? { color: colors.Text03 } : undefined,
                                ]}
                                onPress={toggleModal}
                                numberOfLines={3}
                                wrapText
                                newItem
                                isSubtask={isSubtask}
                                projectId={projectId}
                            >
                                {newItem
                                    ? isSubtask
                                        ? translate('Add new subtask')
                                        : currentUser.uid === loggedUser.uid
                                        ? translate('Type to add new task')
                                        : translate('Type to suggest a new task')
                                    : ''}
                            </SocialText>
                            {!isSubtask && !hideParentGoalButton && (
                                <WrapperTaskParentGoalModal
                                    projectId={projectId}
                                    activeGoal={activeGoal}
                                    dateFormated={dateFormated}
                                />
                            )}
                        </View>
                    </View>
                </View>
            </View>

            {showShortcuts && !isSubtask && newItem && accessGranted && !isLocked && (
                <View style={{ position: 'absolute', top: 0, right: 14 }}>
                    <Shortcut text={'+'} />
                </View>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        justifyContent: 'center',
        marginLeft: -16,
        marginRight: -16,
    },
    taskRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        paddingHorizontal: 8,
        marginHorizontal: 8,
        borderRadius: 4,
    },
    checkBoxLabel: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        flex: 1,
    },
    checkBox: {
        marginTop: 8,
    },
    descriptionContainer: {
        flexGrow: 1,
        paddingLeft: 12,
        flex: 1,
    },
    descriptionText: {
        display: 'flex',
        marginTop: 5, // 8 - 3 px of line spacing
        marginBottom: 5, // 8 - 3 px of line spacing
        alignItems: 'flex-start',
        maxHeight: 90,
    },
    innerTaskTags: {
        marginTop: 5, // 8 - 3 px of line spacing
        marginBottom: 5, // 8 - 3 px of line spacing
        paddingRight: 8,
        alignItems: 'center',
        flexDirection: 'row',
    },
    newItemPlaceholderText: {
        color: colors.Text03,
    },
    dragModeContainer: {
        marginRight: 44,
    },
})

const subTaskStyles = StyleSheet.create({
    taskRow: {
        backgroundColor: colors.Grey200,
        paddingHorizontal: 4,
        marginHorizontal: 16,
    },
    descriptionText: {
        marginTop: 6, // 9 - 3 px of line spacing
        marginBottom: 6, // 9 - 3 px of line spacing
        maxHeight: 90,
    },
    descriptionContainer: {
        paddingLeft: 10,
    },
    checkBox: {
        marginTop: 10,
    },
    innerTaskTags: {
        marginTop: 6, // 9 - 3 px of line spacing
        marginBottom: 6, // 9 - 3 px of line spacing
    },
    dragModeContainer: {
        marginRight: 44,
    },
})

export default AddTask
