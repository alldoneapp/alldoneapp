import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

import { colors } from '../../../styles/global'
import ModalHeader from '../ModalHeader'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import useWindowSize from '../../../../utils/useWindowSize'
import { translate } from '../../../../i18n/TranslationService'
import AssistantItem from './AssistantItem'
import { getSafeAreaModalMaxHeight } from '../../../../utils/modalSafeArea'

/**
 * AT-2430 — the assistant line's "switch assistant" popup.
 *
 * Same card as `AssistantModal` (which assigns an assistant to an object) and the same rows, but
 * it takes a pre-built, project-grouped option list instead of deriving one project's list from
 * the store: the all-projects scope spans every active project, and one project's assistants are
 * indistinguishable from another's without the header — display names repeat across projects as
 * separate assistant documents.
 *
 * `grouped` is off for the single-project scope, where a header would just restate the project
 * the user is already looking at.
 */
export default function AssistantSwitchModal({
    closeModal,
    groups = [],
    grouped = false,
    activeProjectId = null,
    activeAssistantId = null,
    onSelect,
}) {
    const [width, height] = useWindowSize()

    const selectOption = option => {
        onSelect?.(option)
        closeModal?.()
    }

    return (
        <View>
            <View
                style={[localStyles.container, applyPopoverWidth(), { maxHeight: getSafeAreaModalMaxHeight(height) }]}
            >
                <CustomScrollView style={localStyles.scroll} showsVerticalScrollIndicator={false}>
                    <ModalHeader
                        closeModal={closeModal}
                        title={translate('Switch assistant')}
                        description={translate('Select the assistant that will help you')}
                    />
                    <View style={localStyles.list}>
                        {groups.map(group => (
                            <View key={group.projectId}>
                                {grouped && (
                                    <Text style={localStyles.groupHeader} numberOfLines={1}>
                                        {group.projectName}
                                    </Text>
                                )}
                                {group.options.map(option => (
                                    <AssistantItem
                                        key={option.key}
                                        projectId={option.projectId}
                                        assistant={option.assistant}
                                        currentAssistantId={activeAssistantId}
                                        isDefaultProjectOption={option.isDefaultProjectAssistant}
                                        // The list already knows which row is live, including which
                                        // PROJECT it belongs to — see AssistantItem's `selected` prop.
                                        selected={
                                            option.assistantId === activeAssistantId &&
                                            (!activeProjectId || option.projectId === activeProjectId)
                                        }
                                        alwaysUpdateOnSelect={true}
                                        updateAssistant={() => selectOption(option)}
                                        closeModal={closeModal}
                                    />
                                ))}
                            </View>
                        ))}
                    </View>
                </CustomScrollView>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
        elevation: 3,
    },
    scroll: {
        padding: 16,
    },
    list: {
        marginHorizontal: -8,
    },
    groupHeader: {
        fontSize: 12,
        fontWeight: '600',
        color: colors.Text03,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        marginTop: 12,
        marginBottom: 2,
        marginHorizontal: 8,
    },
})
