import React from 'react'
import { StyleSheet, View } from 'react-native'
import { useSelector } from 'react-redux'

import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../../utils/HelperFunctions'
import CustomScrollView from '../../../../UIControls/CustomScrollView'
import { colors } from '../../../../styles/global'
import useWindowSize from '../../../../../utils/useWindowSize'
import { translate } from '../../../../../i18n/TranslationService'
import ModalHeader from '../../../../UIComponents/FloatModals/ModalHeader'
import OptionItem from './OptionItem'
import { shrinkTagText } from '../../../../../functions/Utils/parseTextUtils'
import { TASK_OPTION } from '../helper'
import {
    TASK_TYPE_EXTERNAL_LINK,
    TASK_TYPE_PROMPT,
} from '../../../../UIComponents/FloatModals/PreConfigTaskModal/TaskModal'

export default function MainModal({ closeModal, options, openPreconfigTaskModal, openOutOfGoldModal }) {
    const smallScreenNavigation = useSelector(state => state.smallScreenNavigation)
    const isMiddleScreen = useSelector(state => state.isMiddleScreen)
    const gold = useSelector(state => state.loggedUser.gold)
    const [width, height] = useWindowSize()

    const isTaskWithPromptAndVariables = (type, task) => {
        return type === TASK_OPTION && task.type === TASK_TYPE_PROMPT && task.variables.length > 0
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                <ModalHeader closeModal={closeModal} title={translate('More options')} />
                {options.map(({ id, type, text, icon, action, task }, index) => {
                    return isTaskWithPromptAndVariables(type, task) ? (
                        <OptionItem
                            key={id}
                            icon={icon}
                            notTranslatedText={shrinkTagText(
                                task.name,
                                smallScreenNavigation ? 20 : isMiddleScreen ? 25 : 30
                            )}
                            shortcut={(index + 1).toString()}
                            action={
                                gold > 0
                                    ? () => {
                                          openPreconfigTaskModal(task)
                                      }
                                    : openOutOfGoldModal
                            }
                        />
                    ) : (
                        <OptionItem
                            key={id}
                            icon={icon}
                            notTranslatedText={
                                task
                                    ? shrinkTagText(task.name, smallScreenNavigation ? 20 : isMiddleScreen ? 25 : 30)
                                    : text
                            }
                            shortcut={(index + 1).toString()}
                            action={
                                type !== TASK_OPTION || task.type === TASK_TYPE_EXTERNAL_LINK || gold > 0
                                    ? () => {
                                          action()
                                          closeModal()
                                      }
                                    : openOutOfGoldModal
                            }
                        />
                    )
                })}
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        backgroundColor: colors.Secondary400,
        borderRadius: 4,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    scroll: {
        paddingTop: 16,
        paddingLeft: 16,
        paddingRight: 16,
        paddingBottom: 8,
    },
})
