import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch } from 'react-redux'

import ProjectModalItem from '../SelectProjectModal/ProjectModalItem'
import CustomScrollView from '../../../UIControls/CustomScrollView'
import Button from '../../../UIControls/Button'
import ModalHeader from '../ModalHeader'
import Line from '../GoalMilestoneModal/Line'
import { blockBackgroundTabShortcut, unblockBackgroundTabShortcut } from '../../../../redux/actions'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../../utils/HelperFunctions'
import useWindowSize from '../../../../utils/useWindowSize'
import { translate } from '../../../../i18n/TranslationService'
import { colors } from '../../../styles/global'

const ROW_HEIGHT = 48

/**
 * The unified flat project pick-list (MODAL_IMPROVEMENT_PLAN.md, Phase 4/5).
 * Callers own fetching, filtering and sorting; this renders, keyboard-navigates
 * and commits. Two commit modes: 'click' selects on row press (the common
 * picker), 'confirm' highlights on press and commits through a footer button
 * (the go-to-project flows). Always closes itself after a commit. Escape comes
 * through ModalHeader's CloseButton, which sits on the LIFO escape stack.
 *
 * The tabbed pickers (SelectProjectModal + SelectProjectModalInSearch) are not
 * on this component yet — see the plan for the real*-vs-plain id-set decision
 * and the move-engine split that migration needs first.
 */
export default function ProjectListModal({
    closeModal,
    projects,
    title,
    description,
    onSelectProject, // (project, arrayIndex) => void
    commitMode = 'click',
    confirmLabel,
    selectedProjectId,
}) {
    const dispatch = useDispatch()
    const [activeOptionIndex, setActiveOptionIndex] = useState(-1)
    const viewportRef = useRef({ top: 0, height: 0 })
    const [, height] = useWindowSize()
    const scrollRef = useRef()

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
        if (projects.length === 0) return
        const next =
            activeOptionIndex === -1
                ? delta > 0
                    ? 0
                    : projects.length - 1
                : (activeOptionIndex + delta + projects.length) % projects.length
        setActiveOptionIndex(next)
        revealRow(next)
    }

    const commit = index => {
        if (index < 0 || !projects[index]) return
        onSelectProject(projects[index], index)
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
                if (activeOptionIndex === -1) closeModal()
                else commit(activeOptionIndex)
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
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <ModalHeader closeModal={closeModal} title={title} description={description} />

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
                    {projects.map((projectItem, index) => (
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
                    ))}
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
    buttonsContainer: {
        marginTop: 8,
        flexDirection: 'row',
        justifyContent: 'center',
    },
})
