import React, { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import styles, { colors } from '../../styles/global'
import Icon from '../../Icon'
import { TouchableOpacity } from 'react-native-gesture-handler'
import StatusPickerStepItem from './StatusPickerStepItem'
import TasksHelper, { DONE_STEP, NONE_STEP, OPEN_STEP } from '../../TaskListView/Utils/TasksHelper'
import { applyPopoverWidth, chronoEntriesOrder } from '../../../utils/HelperFunctions'
import Hotkeys from 'react-hot-keys'
import useWindowSize from '../../../utils/useWindowSize'
import CustomScrollView from '../../UIControls/CustomScrollView'
import { translate } from '../../../i18n/TranslationService'
import { getSafeAreaModalMaxHeight } from '../../../utils/modalSafeArea'

export default function StatusPicker({ projectId, workflow, task, hidePopover }) {
    const [width, height] = useWindowSize()
    let { steps, selected, nextStepNum } = workflow
        ? TasksHelper.getWorkflowStatusOfTask(workflow, task)
        : { steps: {}, selected: NONE_STEP, nextStepNum: OPEN_STEP }

    const itemRefs = []

    const [hoverStep, setHoverStep] = useState(selected)
    const sortedSteps = Object.entries(steps).sort(chronoEntriesOrder)
    const indexes = TasksHelper.generateWorkflowStepIndexes(sortedSteps.length).filter(
        index => !task.workflowTask || index !== OPEN_STEP
    )

    const getNextStepIndex = () => {
        const index = indexes.indexOf(hoverStep)
        let next = index + 1

        if (index === indexes.length - 1) {
            return indexes[0]
        } else {
            return indexes[next]
        }
    }

    const getPreviousStepIndex = () => {
        const index = indexes.indexOf(hoverStep)
        let prev = index - 1

        if (index === 0) {
            return indexes[indexes.length - 1]
        } else {
            return indexes[prev]
        }
    }

    const onPressEnter = () => {
        itemRefs[hoverStep].onPressed()
    }

    const onKeyPress = (s, e, handler) => {
        switch (handler.key) {
            case 'up': {
                setHoverStep(getPreviousStepIndex())
                break
            }
            case 'down': {
                setHoverStep(getNextStepIndex())
                break
            }
            case 'enter': {
                onPressEnter()
                break
            }
        }
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth(), { maxHeight: getSafeAreaModalMaxHeight(height) }]}>
            <CustomScrollView style={localStyles.innerContainer2} showsVerticalScrollIndicator={false}>
                <View style={localStyles.innerContainer}>
                    <Hotkeys keyName={'up,down,enter'} onKeyDown={onKeyPress} filter={e => true}>
                        <View style={localStyles.heading}>
                            <View style={localStyles.title}>
                                <Text style={[styles.title7, { color: 'white' }]}>{translate('Task status')}</Text>
                                <Text style={[styles.body2, { color: colors.Text03, width: 273 }]}>
                                    {translate('Choose a workflow step to move this task')}
                                </Text>
                            </View>
                        </View>
                    </Hotkeys>

                    <View style={localStyles.contentContainer}>
                        {!task.workflowTask && (
                            <StatusPickerStepItem
                                ref={ref => (itemRefs[OPEN_STEP] = ref)}
                                open
                                task={task}
                                projectId={projectId}
                                currentStepNum={selected}
                                workflow={steps}
                                stepNum={OPEN_STEP}
                                onPress={() => {
                                    selected = OPEN_STEP
                                }}
                                selected={selected === OPEN_STEP}
                                hidePopover={hidePopover}
                                active={hoverStep === OPEN_STEP}
                            />
                        )}
                        {sortedSteps.map((step, index) => (
                            <StatusPickerStepItem
                                ref={ref => (itemRefs[index] = ref)}
                                key={index}
                                onPress={() => {
                                    selected = index
                                }}
                                selected={index === selected}
                                stepNum={index + 1}
                                currentStepNum={selected}
                                step={step}
                                isNextStep={nextStepNum === index}
                                workflow={steps}
                                projectId={projectId}
                                task={task}
                                hidePopover={hidePopover}
                                active={hoverStep === index}
                            />
                        ))}
                        <StatusPickerStepItem
                            ref={ref => (itemRefs[DONE_STEP] = ref)}
                            done
                            onPress={() => {
                                selected = DONE_STEP
                            }}
                            stepNum={DONE_STEP}
                            isNextStep={nextStepNum === Object.keys(steps).length}
                            currentStepNum={selected}
                            selected={selected === DONE_STEP}
                            workflow={steps}
                            projectId={projectId}
                            task={task}
                            hidePopover={hidePopover}
                            active={hoverStep === DONE_STEP}
                        />
                    </View>

                    <View style={localStyles.closeContainer}>
                        <TouchableOpacity style={localStyles.closeButton} onPress={hidePopover}>
                            <Icon name="x" size={24} color={colors.Text03} />
                        </TouchableOpacity>
                    </View>
                </View>
            </CustomScrollView>
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        flexDirection: 'column',
        width: 305,
        boxShadow: '0px 4px 16px rgba(78,93,120,0.56)',
        elevation: 3,
    },
    innerContainer: {
        flexDirection: 'column',
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
    },
    contentContainer: {
        marginTop: 20,
        paddingHorizontal: 16,
        paddingBottom: 8,
    },
    heading: {
        flexDirection: 'row',
        paddingLeft: 16,
        paddingTop: 8,
        paddingRight: 8,
    },
    title: {
        flexDirection: 'column',
        marginTop: 8,
    },
    closeContainer: {
        position: 'absolute',
        top: 8,
        right: 8,
    },
    closeButton: {
        alignItems: 'center',
        justifyContent: 'center',
    },
})
