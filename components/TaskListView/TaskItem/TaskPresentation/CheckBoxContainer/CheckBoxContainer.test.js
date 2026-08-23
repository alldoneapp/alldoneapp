import React from 'react'
import renderer from 'react-test-renderer'
import { nodeMockOptions } from '../../../../../testUtils/domNodeStub'
import { Animated, TouchableOpacity } from 'react-native'

jest.mock('../../../../../i18n/TranslationService', () => ({ translate: text => text }))

import CheckBoxContainer from './CheckBoxContainer'
import ActionPopupIndicator from './ActionPopupIndicator'
import AiStepCheckBox from './AiStepCheckBox'
import TaskCompletionCelebration from './TaskCompletionCelebration'
import CheckBox from '../../../../CheckBox'

const celebration = () => ({
    punch: new Animated.Value(1),
    burst: new Animated.Value(0),
    opacity: new Animated.Value(0),
    animated: true,
})

const getProps = overrides => ({
    isSubtask: false,
    isObservedTask: false,
    isToReviewTask: false,
    isSuggested: false,
    isActiveOrganizeMode: false,
    checkOnDrag: false,
    highlightColor: '#fff',
    accessGranted: true,
    pending: false,
    showWorkflowIndicator: false,
    showEmailCompletionIndicator: false,
    isNextStepAi: false,
    aiStepRunning: false,
    onCheckboxPress: jest.fn(),
    checkBoxIdRef: { current: 'checkbox-1' },
    checked: false,
    loggedUserCanUpdateObject: true,
    ...overrides,
})

describe('CheckBoxContainer action popup indicator', () => {
    test('shows the workflow-style dot and opens an interaction for an email-linked task', () => {
        const props = getProps({ showEmailCompletionIndicator: true })
        const tree = renderer.create(<CheckBoxContainer {...props} />, nodeMockOptions)

        expect(tree.root.findByType(ActionPopupIndicator).props.visible).toBe(true)
        tree.root.findByType(TouchableOpacity).props.onPress()
        expect(props.onCheckboxPress).toHaveBeenCalledWith(true)
    })

    test('preserves direct checkbox behavior for a regular task', () => {
        const props = getProps()
        const tree = renderer.create(<CheckBoxContainer {...props} />, nodeMockOptions)

        expect(tree.root.findByType(ActionPopupIndicator).props.visible).toBe(false)
        tree.root.findByType(TouchableOpacity).props.onPress()
        expect(props.onCheckboxPress).toHaveBeenCalledWith(false)
        expect(tree.root.findAllByType(CheckBox)).toHaveLength(1)
        expect(tree.root.findAllByType(AiStepCheckBox)).toHaveLength(0)
    })

    test('replaces the unchecked control for an AI next step without changing its interaction', () => {
        const props = getProps({ isNextStepAi: true })
        const tree = renderer.create(<CheckBoxContainer {...props} />, nodeMockOptions)
        const button = tree.root.findByType(TouchableOpacity)

        expect(tree.root.findAllByType(CheckBox)).toHaveLength(0)
        expect(tree.root.findByType(AiStepCheckBox).props.running).toBe(false)
        expect(button.props.title).toBe('Run AI step')
        expect(button.props.accessibilityLabel).toBe('Run AI step')

        button.props.onPress()
        expect(props.onCheckboxPress).toHaveBeenCalledWith(false)
    })

    test('shows the AI control running state while its transition is pending', () => {
        const tree = renderer.create(
            <CheckBoxContainer {...getProps({ isNextStepAi: true, aiStepRunning: true, checked: true })} />,
            nodeMockOptions
        )

        expect(tree.root.findByType(AiStepCheckBox).props.running).toBe(true)
    })

    test('uses the normal completed treatment after an AI action completes', () => {
        const tree = renderer.create(
            <CheckBoxContainer {...getProps({ isNextStepAi: true, checked: true })} />,
            nodeMockOptions
        )

        expect(tree.root.findAllByType(AiStepCheckBox)).toHaveLength(0)
        expect(tree.root.findByType(CheckBox).props.checked).toBe(true)
    })
})

describe('CheckBoxContainer completion celebration (AT-2404)', () => {
    test('is absent on an ordinary row, so a long list mounts nothing extra', () => {
        const tree = renderer.create(<CheckBoxContainer {...getProps()} />, nodeMockOptions)

        expect(tree.root.findAllByType(TaskCompletionCelebration)).toHaveLength(0)
    })

    test('punches the real checkbox rather than a stand-in', () => {
        const completion = celebration()
        const tree = renderer.create(
            <CheckBoxContainer {...getProps({ completionCelebration: completion })} />,
            nodeMockOptions
        )

        // What squashes and springs back has to be the element the finger landed on; scaling only
        // the green overlay would leave the checkbox itself sitting still underneath it.
        const scaler = tree.root.findAllByProps({ testID: 'task-completion-checkbox-punch' }, { deep: false })[0]
        expect(scaler.props.style.transform).toEqual([{ scale: completion.punch }])
        expect(scaler.findAllByType(CheckBox)).toHaveLength(1)
        expect(tree.root.findByType(TaskCompletionCelebration).props.burst).toBe(completion.burst)
    })

    test('passes the subtask size through so a 20px checkbox is not ringed as a 24px one', () => {
        const tree = renderer.create(
            <CheckBoxContainer {...getProps({ isSubtask: true, completionCelebration: celebration() })} />,
            nodeMockOptions
        )

        expect(tree.root.findByType(TaskCompletionCelebration).props.isSubtask).toBe(true)
    })

    test.each([
        ['a task waiting on someone else', { pending: true }],
        ['an unchecked AI step control', { isNextStepAi: true }],
        ['a running AI step control', { isNextStepAi: true, aiStepRunning: true, checked: true }],
    ])('stands down over %s', (_description, overrides) => {
        const tree = renderer.create(
            <CheckBoxContainer {...getProps({ ...overrides, completionCelebration: celebration() })} />,
            nodeMockOptions
        )

        // The celebration draws a green "done" tile over the control. The clock and the AI step are
        // different affordances with their own state, and covering either would say something
        // untrue about what just happened.
        expect(tree.root.findAllByType(TaskCompletionCelebration)).toHaveLength(0)
    })
})
