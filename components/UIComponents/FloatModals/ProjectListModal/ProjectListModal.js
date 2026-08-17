import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch } from 'react-redux'

import ProjectModalItem from '../SelectProjectModal/ProjectModalItem'
import AllProjectItem from '../SelectProjectModal/AllProjectItem'
import HeaderInSearch from '../SelectProjectModal/HeaderInSearch'
import { ALL_PROJECTS_OPTION } from '../SelectProjectModal/projectPickerConstants'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import Button from '../../../UIControls/Button'
import ModalHeader from '../ModalHeader'
import Line from '../GoalMilestoneModal/Line'
import EmptyResults from '../EmptyResults'
import { blockBackgroundTabShortcut, unblockBackgroundTabShortcut } from '../../../../redux/actions'
import { applyPopoverWidth } from '../../../../utils/HelperFunctions'
import useWindowSize from '../../../../utils/useWindowSize'
import { translate } from '../../../../i18n/TranslationService'
import { colors } from '../../../styles/global'
import { getSafeAreaModalMaxHeight } from '../../../../utils/modalSafeArea'

const ROW_HEIGHT = 48

/**
 * The unified flat project pick-list (MODAL_IMPROVEMENT_PLAN.md, Phase 4/5).
 * Callers own fetching, filtering and sorting; this renders, keyboard-navigates
 * and commits. Two commit modes: 'click' selects on row press (the common
 * picker), 'confirm' highlights on press and commits through a footer button
 * (the go-to-project flows). Always closes itself after a commit. Escape comes
 * through ModalHeader's CloseButton, which sits on the LIFO escape stack.
 *
 * Tab support: pass `tabs` ([{ key, name, projects }]) instead of `projects`
 * and the modal owns the active tab (Tab/ArrowRight/ArrowLeft cycle it, the
 * header renders as HeaderInSearch). Callers still own filtering and sorting
 * per tab — which is what keeps the two tabbed pickers' different id-set
 * semantics (real* vs plain) out of this component. `leadingAllOption`
 * prepends the "All projects" row (index -1) on the FIRST tab and commits the
 * ALL_PROJECTS_OPTION sentinel.
 */
export default function ProjectListModal({
    closeModal,
    projects,
    tabs,
    initialTabIndex = 0,
    leadingAllOption = false,
    title,
    description,
    onSelectProject, // (project, arrayIndex) => void
    commitMode = 'click',
    confirmLabel,
    selectedProjectId,
    containerStyle,
    emptyText,
}) {
    const dispatch = useDispatch()
    const [activeTabIndex, setActiveTabIndex] = useState(initialTabIndex)
    const currentProjects = tabs ? tabs[activeTabIndex]?.projects || [] : projects
    const allOptionVisible = leadingAllOption && (!tabs || activeTabIndex === 0)
    const [activeOptionIndex, setActiveOptionIndex] = useState(() => {
        const selectedIndex = selectedProjectId
            ? (tabs ? tabs[initialTabIndex]?.projects || [] : projects).findIndex(
                  project => project.id === selectedProjectId
              )
            : -1
        return selectedIndex >= 0 ? selectedIndex : -1
    })
    const viewportRef = useRef({ top: 0, height: 0 })
    const [, height] = useWindowSize()
    const scrollRef = useRef()

    const changeTab = tabIndex => {
        if (!tabs || tabIndex === activeTabIndex) return
        setActiveTabIndex(tabIndex)
        setActiveOptionIndex(-1)
        scrollRef.current?.scrollTo({ y: 0, animated: false })
    }

    useEffect(() => {
        dispatch(blockBackgroundTabShortcut())
        return () => {
            dispatch(unblockBackgroundTabShortcut())
        }
    }, [])

    // Rows are fixed-height, so keyboard scroll-follow is plain arithmetic —
    // the measure()-based math this replaces silently no-oped (it put refs on
    // a non-forwardRef function component).
    const revealRow = index => {
        const { top, height: viewHeight } = viewportRef.current
        if (!viewHeight) return
        const rowTop = index * ROW_HEIGHT
        const rowBottom = rowTop + ROW_HEIGHT
        if (rowTop < top) {
            scrollRef.current?.scrollTo({ y: rowTop, animated: false })
        } else if (rowBottom > top + viewHeight) {
            scrollRef.current?.scrollTo({ y: rowBottom - viewHeight, animated: false })
        }
    }

    const moveSelection = delta => {
        if (currentProjects.length === 0 && !allOptionVisible) return
        let next
        if (allOptionVisible) {
            // The All row is index -1 and part of the cycle.
            const span = currentProjects.length + 1
            next = ((activeOptionIndex + 1 + delta + span) % span) - 1
        } else {
            next =
                activeOptionIndex === -1
                    ? delta > 0
                        ? 0
                        : currentProjects.length - 1
                    : (activeOptionIndex + delta + currentProjects.length) % currentProjects.length
        }
        setActiveOptionIndex(next)
        if (next >= 0) revealRow(next)
        else scrollRef.current?.scrollTo({ y: 0, animated: false })
    }

    // Awaits the handler on purpose: the move-object flow must finish its
    // backend work before the picker reports itself closed (the old tabbed
    // modal awaited the move before calling closePopover).
    const commit = async index => {
        if (index === -1 && allOptionVisible) {
            await onSelectProject({ id: ALL_PROJECTS_OPTION }, -1)
            closeModal()
            return
        }
        if (index < 0 || !currentProjects[index]) return
        await onSelectProject(currentProjects[index], index)
        closeModal()
    }

    const onRowPress = index => {
        if (commitMode === 'confirm') setActiveOptionIndex(index)
        else commit(index)
    }

    useEffect(() => {
        const onKeyPress = event => {
            const { key } = event
            if (key === 'ArrowUp') moveSelection(-1)
            else if (key === 'ArrowDown') moveSelection(1)
            else if (key === 'Enter') {
                if (activeOptionIndex === -1 && !allOptionVisible) closeModal()
                else commit(activeOptionIndex)
            } else if (tabs && (key === 'Tab' || key === 'ArrowRight')) {
                changeTab(activeTabIndex + 1 === tabs.length ? 0 : activeTabIndex + 1)
            } else if (tabs && key === 'ArrowLeft') {
                changeTab(activeTabIndex === 0 ? tabs.length - 1 : activeTabIndex - 1)
            }
            if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'Enter') {
                event.preventDefault()
                event.stopPropagation()
            }
        }
        document.addEventListener('keydown', onKeyPress)
        return () => document.removeEventListener('keydown', onKeyPress)
    })

    return (
        <View
            style={[
                localStyles.container,
                applyPopoverWidth(),
                { maxHeight: getSafeAreaModalMaxHeight(height) },
                containerStyle,
            ]}
        >
            <ModalHeader closeModal={closeModal} title={title} description={description} />

            {tabs && (
                <View style={localStyles.tabsContainer}>
                    <HeaderInSearch activeTabIndex={activeTabIndex} changeTab={changeTab} tabs={tabs} />
                </View>
            )}

            <View style={localStyles.projectListContainer}>
                <CustomScrollView
                    ref={scrollRef}
                    showsVerticalScrollIndicator={false}
                    indicatorStyle={{ right: -6 }}
                    scrollOnLayout={data => {
                        scrollRef.current?.scrollTo({ y: 0, animated: false })
                        viewportRef.current = { top: 0, height: data.nativeEvent.layout.height }
                    }}
                    onScroll={({ nativeEvent }) => {
                        viewportRef.current = { ...viewportRef.current, top: nativeEvent.contentOffset.y }
                    }}
                >
                    {allOptionVisible && (
                        <AllProjectItem
                            selectedProjectId={selectedProjectId}
                            onProjectSelect={() => commit(-1)}
                            active={activeOptionIndex === -1}
                        />
                    )}

                    {currentProjects.length > 0 ? (
                        currentProjects.map((projectItem, index) => (
                            <ProjectModalItem
                                key={projectItem.id}
                                selectedProjectId={
                                    commitMode === 'confirm'
                                        ? index === activeOptionIndex
                                            ? projectItem.id
                                            : '-1'
                                        : selectedProjectId || '-1'
                                }
                                newProject={projectItem}
                                active={index === activeOptionIndex}
                                onProjectSelect={() => onRowPress(index)}
                            />
                        ))
                    ) : (
                        <EmptyResults
                            text={emptyText || translate('There are not projects to show here')}
                            style={localStyles.empty}
                        />
                    )}
                </CustomScrollView>
            </View>

            {commitMode === 'confirm' && (
                <>
                    <Line />
                    <View style={localStyles.buttonsContainer}>
                        <Button
                            title={translate('Cancel')}
                            type={'secondary'}
                            onPress={closeModal}
                            buttonStyle={{ marginRight: 8 }}
                        />
                        <Button
                            title={confirmLabel || translate('Proceed')}
                            type={'primary'}
                            onPress={() => commit(activeOptionIndex)}
                            disabled={activeOptionIndex === -1}
                        />
                    </View>
                </>
            )}
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        padding: 16,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
        elevation: 3,
        maxHeight: 356,
        zIndex: 11000,
    },
    projectListContainer: {
        flex: 1,
        flexDirection: 'column',
        marginHorizontal: -8,
    },
    tabsContainer: {
        marginTop: 12,
    },
    empty: {
        marginBottom: 32,
    },
    buttonsContainer: {
        marginTop: 8,
        flexDirection: 'row',
        justifyContent: 'center',
    },
})
