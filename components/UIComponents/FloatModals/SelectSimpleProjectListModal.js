import React, { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { useDispatch } from 'react-redux'

import ProjectModalItem from '../../UIComponents/FloatModals/SelectProjectModal/ProjectModalItem'
import CustomScrollView from '../../UIControls/CustomScrollView'
import { blockBackgroundTabShortcut, unblockBackgroundTabShortcut } from '../../../redux/actions'
import { applyPopoverWidth, MODAL_MAX_HEIGHT_GAP } from '../../../utils/HelperFunctions'
import useWindowSize from '../../../utils/useWindowSize'
import { translate } from '../../../i18n/TranslationService'
import { colors } from '../../styles/global'
import Button from '../../UIControls/Button'
import ModalHeader from '../../UIComponents/FloatModals/ModalHeader'
import Line from '../../UIComponents/FloatModals/GoalMilestoneModal/Line'

export default function SelectSimpleProjectListModal({ closeModal, projects, title, description, onSelectProject }) {
    const dispatch = useDispatch()
    const [offsets, setOffsets] = useState({ top: 0, bottom: 0 })
    const [scrollHeight, setScrollHeight] = useState(0)
    const [activeOptionIndex, setActiveOptionIndex] = useState(-1)
    const [width, height] = useWindowSize()

    const scrollRef = useRef()
    const itemsRef = useRef([])

    useEffect(() => {
        dispatch(blockBackgroundTabShortcut())
        return () => {
            dispatch(unblockBackgroundTabShortcut())
        }
    }, [])

    useEffect(() => {
        document.addEventListener('keydown', onKeyPress)
        return () => {
            document.removeEventListener('keydown', onKeyPress)
        }
    })

    const selectDown = () => {
        scrollToFocusItem(activeOptionIndex)
        if (activeOptionIndex + 1 === projects.length) {
            setActiveOptionIndex(0)
        } else {
            setActiveOptionIndex(activeOptionIndex + 1)
        }
    }

    const selectUp = () => {
        scrollToFocusItem(activeOptionIndex, true)
        if (activeOptionIndex <= 0) {
            setActiveOptionIndex(projects.length - 1)
        } else {
            setActiveOptionIndex(activeOptionIndex - 1)
        }
    }

    const scrollToFocusItem = (key, up = false) => {
        if (up && key === -1) {
            scrollRef?.current?.scrollTo({ y: projects.length * 48, animated: false })
        } else if (!up && key + 1 === projects.length) {
            scrollRef?.current?.scrollTo({ y: 0, animated: false })
        } else {
            const space = up ? 96 : 144
            itemsRef.current[key]?.measure((fx, fy) => {
                if (up && fy - space < offsets.top) {
                    scrollRef?.current?.scrollTo({ y: fy - space, animated: false })
                } else if (up && fy > offsets.bottom) {
                    scrollRef?.current?.scrollTo({ y: fy + 48 - scrollHeight, animated: false })
                } else if (!up && fy + space > offsets.bottom) {
                    scrollRef?.current?.scrollTo({ y: fy + space - scrollHeight, animated: false })
                } else if (!up && fy + 48 < offsets.top) {
                    scrollRef?.current?.scrollTo({ y: fy + 48, animated: false })
                }
            })
        }
    }

    const onLayoutScroll = data => {
        scrollRef?.current?.scrollTo({ y: 0, animated: false })
        setOffsets({ top: 0, bottom: data.nativeEvent.layout.height })
        setScrollHeight(data.nativeEvent.layout.height)
    }

    const selectOption = () => {
        if (activeOptionIndex === -1) {
            closeModal()
        } else {
            onSelectProject(projects[activeOptionIndex].index, projects[activeOptionIndex])
        }
    }

    const onKeyPress = event => {
        const { key } = event

        switch (event.key) {
            case 'ArrowUp': {
                selectUp()
                break
            }
            case 'ArrowDown': {
                selectDown()
                break
            }
            case 'Enter': {
                selectOption()
                break
            }
        }

        if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'Enter') {
            event.preventDefault()
            event.stopPropagation()
        }
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: height - MODAL_MAX_HEIGHT_GAP }]}>
            <ModalHeader closeModal={closeModal} title={title} description={description} />

            <View style={localStyles.projectListContainer}>
                <CustomScrollView
                    ref={scrollRef}
                    showsVerticalScrollIndicator={false}
                    indicatorStyle={{ right: -6 }}
                    scrollOnLayout={onLayoutScroll}
                    onScroll={({ nativeEvent }) => {
                        const y = nativeEvent.contentOffset.y
                        setOffsets({ top: y, bottom: y + scrollHeight })
                    }}
                >
                    {projects.map((projectItem, index) => {
                        return (
                            <ProjectModalItem
                                ref={ref => (itemsRef.current[index] = ref)}
                                key={projectItem.id}
                                selectedProjectId={index === activeOptionIndex ? projectItem.id : '-1'}
                                newProject={projectItem}
                                active={index === activeOptionIndex}
                                onProjectSelect={() => {
                                    setActiveOptionIndex(index)
                                }}
                            />
                        )
                    })}
                </CustomScrollView>
            </View>
            <Line />
            <View style={localStyles.buttonsContainer}>
                <Button
                    title={translate('Cancel')}
                    type={'secondary'}
                    onPress={closeModal}
                    buttonStyle={{ marginRight: 8 }}
                />
                <Button
                    title={translate('Go to selected project')}
                    type={'primary'}
                    onPress={selectOption}
                    disabled={activeOptionIndex === -1}
                />
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
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
        maxHeight: 356,
        zIndex: 11000,
    },
    projectListContainer: {
        flex: 1,
        flexDirection: 'column',
        marginHorizontal: -8,
    },
    closeSubContainer: {
        width: 24,
        height: 24,
    },
    closeContainer: {
        position: 'absolute',
        top: 0,
        right: 8,
    },
    heading: {
        paddingHorizontal: 16,
    },
    title: {
        flexDirection: 'column',
        marginTop: 8,
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
