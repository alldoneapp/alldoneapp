import React, { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'

import styles, { colors } from '../styles/global'
import Icon from '../Icon'
import CloseButton from '../FollowUp/CloseButton'
import WorkflowStepItem from './WorkflowStepItem'
import { applyPopoverWidth, chronoEntriesOrder } from '../../utils/HelperFunctions'
import TasksHelper, { DONE_STEP, OPEN_STEP } from '../TaskListView/Utils/TasksHelper'
import Shortcut, { SHORTCUT_LIGHT } from '../UIControls/Shortcut'
import { useSelector } from 'react-redux'
import Hotkeys from 'react-hot-keys'
import { translate } from '../../i18n/TranslationService'

export default function WorkflowSelection({
    closePopover,
    steps,
    task,
    estimations,
    assignee,
    selectedNextStep,
    selectStep,
    currentStep,
}) {
    const mobile = useSelector(state => state.smallScreenNavigation)
    const [hoverStep, setHoverStep] = useState(selectedNextStep)
    const sortedSteps = Object.entries(steps).sort(chronoEntriesOrder)
    const indexes = TasksHelper.generateWorkflowStepIndexes(sortedSteps.length, currentStep)

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

    const onPressEnter = e => {
        e.preventDefault()
        e.stopPropagation()
        selectStep(hoverStep, true)
    }

    const closePopup = e => {
        if (e) {
            e.preventDefault()
            e.stopPropagation()
        }
        closePopover()
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
                onPressEnter(e)
                break
            }
        }
    }

    return (
        <View style={[localStyles.container, applyPopoverWidth()]}>
            <Hotkeys keyName={'up,down,enter'} onKeyDown={onKeyPress} filter={e => true}>
                <View style={localStyles.heading}>
                    <View style={localStyles.title}>
                        <Text style={[styles.title7, { color: 'white', flex: 1 }]}>
                            {translate('Next Workflow step')}
                        </Text>
                        <Text style={[styles.body2, { color: colors.Text03, flex: 1 }]}>
                            {translate('Next Workflow step description')}
                        </Text>
                    </View>
                </View>
            </Hotkeys>

            <View style={localStyles.subsection}>
                <WorkflowStepItem
                    task={task}
                    open
                    selectedNextStep={selectedNextStep}
                    assignee={assignee}
                    selectStep={selectStep}
                    stepIndex={OPEN_STEP}
                    estimations={estimations}
                    currentStep={currentStep}
                    active={hoverStep === OPEN_STEP}
                />
                {sortedSteps.map((step, index) => (
                    <WorkflowStepItem
                        key={index}
                        selectedNextStep={selectedNextStep}
                        step={step}
                        task={task}
                        selectStep={selectStep}
                        stepIndex={index}
                        estimations={estimations}
                        currentStep={currentStep}
                        active={hoverStep === index}
                    />
                ))}
                <WorkflowStepItem
                    done
                    selectedNextStep={selectedNextStep}
                    task={task}
                    selectStep={selectStep}
                    stepIndex={DONE_STEP}
                    estimations={estimations}
                    currentStep={currentStep}
                    active={hoverStep === DONE_STEP}
                />
            </View>
            <Hotkeys keyName={'B'} onKeyDown={(s, e) => closePopup(e)} filter={e => true}>
                <TouchableOpacity style={localStyles.backContainer} onPress={closePopup}>
                    <Icon name="chevron-left" size={24} color={colors.Text03} />
                    <Text style={[styles.subtitle1, localStyles.backText]}>{translate('Back')}</Text>

                    {!mobile && (
                        <View style={localStyles.shortcut}>
                            <Shortcut text={'B'} theme={SHORTCUT_LIGHT} />
                        </View>
                    )}
                </TouchableOpacity>
            </Hotkeys>
            <CloseButton close={closePopup} />
        </View>
    )
}

const localStyles = StyleSheet.create({
    container: {
        width: 305,
        borderRadius: 4,
        backgroundColor: colors.Secondary400,
        shadowColor: 'rgba(78, 93, 120, 0.56)',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 1,
        shadowRadius: 16,
        elevation: 3,
    },
    heading: {
        flex: 1,
        flexDirection: 'row',
        paddingLeft: 16,
        paddingTop: 8,
        paddingRight: 8,
    },
    title: {
        flex: 1,
        flexDirection: 'column',
        marginTop: 8,
    },
    subsection: {
        marginTop: 28,
        marginBottom: 2,
        paddingHorizontal: 16,
        borderBottomColor: colors.funnyWhite,
        borderBottomWidth: 1,
    },
    textInputContainer: {
        borderColor: colors.Gray400,
        borderWidth: 1,
        borderRadius: 4,
        marginTop: 4,
        overflow: 'hidden',
    },
    textInput: {
        width: 273,
        height: 80,
        paddingHorizontal: 16,
        paddingVertical: 8,
        color: 'white',
    },
    upload: {
        height: 40,
        flexDirection: 'row',
        alignItems: 'center',
    },
    uploadText: {
        color: 'white',
        marginLeft: 8,
    },
    uploadSection: {
        marginTop: 8,
        height: 40,
        marginHorizontal: -16,
        paddingHorizontal: 16,
    },
    doneButtonContainer: {
        height: 72,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 16,
    },
    backContainer: {
        flexDirection: 'row',
        paddingVertical: 16,
        paddingLeft: 16,
    },
    backText: {
        color: '#FFFFFF',
        fontWeight: '500',
        marginLeft: 8,
    },
    shortcut: {
        position: 'absolute',
        marginTop: 2,
        right: 16,
    },
})
