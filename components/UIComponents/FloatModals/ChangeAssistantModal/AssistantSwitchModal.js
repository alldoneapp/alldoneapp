import React, { useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../../../styles/global'
import ModalHeader from '../ModalHeader'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import useWindowSize from '../../../../utils/useWindowSize'
import { translate } from '../../../../i18n/TranslationService'
import AssistantItem from './AssistantItem'
import EmptyResults from '../EmptyResults'
import Icon from '../../../Icon'
import useEscapeKey from '../../../../hooks/useEscapeKey'
import { getSafeAreaModalMaxHeight } from '../../../../utils/modalSafeArea'
import { themed } from '../../../../Themes/colorMode'
import { filterAssistantGroups, flattenAssistantGroups } from '../../../MyDayView/AssistantLine/assistantSwitchOptions'

export const ASSISTANT_SWITCH_SEARCH_TEST_ID = 'assistant-switch-search'

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
 *
 * AT-3100 — a search field under the header filters the rows by assistant name as you type
 * (`filterAssistantGroups`: case-insensitive, groups without a match disappear). The header and
 * the field sit outside the scroll view so they stay put while the list scrolls. Deliberately not
 * autofocused (product decision): on phones the keyboard would cover the list the user opened
 * the popup to look at. Enter picks the first match; Escape clears a non-empty query before
 * anything else gets the key.
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
    const [query, setQuery] = useState('')
    const inputRef = useRef(null)

    const visibleGroups = useMemo(() => filterAssistantGroups(groups, query), [groups, query])
    const hasQuery = query.trim() !== ''

    const selectOption = option => {
        onSelect?.(option)
        closeModal?.()
    }

    const clearQuery = () => {
        setQuery('')
        inputRef.current?.focus?.()
    }

    useEscapeKey(clearQuery, { enabled: query !== '' })

    const selectFirstMatch = () => {
        if (!hasQuery) return
        const [first] = flattenAssistantGroups(visibleGroups)
        if (first) selectOption(first)
    }

    const searchLabel = translate('Search assistants')

    return (
        <View>
            <View
                style={[localStyles.container, applyPopoverWidth(), { maxHeight: getSafeAreaModalMaxHeight(height) }]}
            >
                <ModalHeader
                    closeModal={closeModal}
                    title={translate('Switch assistant')}
                    description={translate('Select the assistant that will help you')}
                />
                <View style={localStyles.searchBox}>
                    <Icon name="search" size={18} color={colors.Text03} />
                    <TextInput
                        ref={inputRef}
                        testID={ASSISTANT_SWITCH_SEARCH_TEST_ID}
                        value={query}
                        onChangeText={setQuery}
                        onSubmitEditing={selectFirstMatch}
                        placeholder={searchLabel}
                        placeholderTextColor={colors.Text03}
                        accessibilityLabel={searchLabel}
                        style={localStyles.input}
                        underlineColorAndroid="transparent"
                        autoCorrect={false}
                        autoCapitalize="none"
                        returnKeyType="go"
                    />
                    {query !== '' && (
                        <TouchableOpacity
                            onPress={clearQuery}
                            accessibilityRole="button"
                            accessibilityLabel={translate('Clear')}
                            style={localStyles.clearButton}
                        >
                            <Icon name="x" size={18} color={colors.Text03} />
                        </TouchableOpacity>
                    )}
                </View>
                <View style={localStyles.listContainer}>
                    <CustomScrollView showsVerticalScrollIndicator={false} indicatorStyle={{ right: -6 }}>
                        {visibleGroups.length > 0 ? (
                            visibleGroups.map(group => (
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
                            ))
                        ) : hasQuery ? (
                            <View accessibilityLiveRegion="polite">
                                <EmptyResults text={translate('No assistants found')} style={localStyles.empty} />
                            </View>
                        ) : null}
                    </CustomScrollView>
                </View>
            </View>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        padding: 16,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        boxShadow: themed.PopupShadow,
        elevation: 3,
    },
    // Same field as the assistant line's template search (AssistantTaskSearchModal).
    searchBox: {
        height: 40,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: colors.Primary200,
        backgroundColor: colors.Secondary300,
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 10,
        marginBottom: 4,
    },
    input: {
        ...styles.body1,
        color: '#ffffff',
        flex: 1,
        minWidth: 0,
        marginLeft: 8,
        outlineStyle: 'none',
    },
    clearButton: {
        marginLeft: 4,
        padding: 2,
    },
    listContainer: {
        flex: 1,
        flexDirection: 'column',
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
    empty: {
        paddingBottom: 24,
    },
})
