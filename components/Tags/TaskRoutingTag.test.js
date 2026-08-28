import React from 'react'
import { AccessibilityInfo } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import TaskRoutingTag from './TaskRoutingTag'

// Resolved through the REAL en.json rather than echoing the key back. That makes these
// assertions fail if a string is ever removed from the translation file, or if the
// `{{project}}` placeholder is dropped from it — both of which would ship a badge reading
// literally "Moved to project" with no way for a unit test to notice.
jest.mock('../../i18n/TranslationService', () => {
    const en = require('../../i18n/translations/en.json')
    return {
        translate: (key, params) => {
            const template = en[key] === undefined ? key : en[key]
            if (!params) return template
            return Object.keys(params).reduce((text, name) => text.replace(`{{${name}}}`, params[name]), template)
        },
    }
})

const render = async element => {
    let tree
    await act(async () => {
        tree = renderer.create(element)
        await Promise.resolve()
    })
    return tree
}

// The confirmation badge puts the same string in its accessibility label and its visible text,
// so asserting on the label checks the message a sighted user reads AND the one announced.
const confirmationLabel = tree =>
    tree.root.findByProps({ testID: 'task-routing-confirmation-tag' }).props.accessibilityLabel

describe('TaskRoutingTag', () => {
    const originalIsReduceMotionEnabled = AccessibilityInfo.isReduceMotionEnabled
    const originalAddEventListener = AccessibilityInfo.addEventListener

    beforeEach(() => {
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(false))
        AccessibilityInfo.addEventListener = jest.fn(() => ({ remove: jest.fn() }))
    })

    afterEach(() => {
        AccessibilityInfo.isReduceMotionEnabled = originalIsReduceMotionEnabled
        AccessibilityInfo.addEventListener = originalAddEventListener
    })

    it('renders nothing for an ordinary task', async () => {
        const tree = await render(<TaskRoutingTag processing={null} confirmation={null} projectName="Alldone" />)

        expect(tree.toJSON()).toBeNull()
    })

    it('shows the sparkle while the server is still deciding', async () => {
        const tree = await render(
            <TaskRoutingTag processing={{ subject: 'project' }} confirmation={null} projectName="Alldone" />
        )

        expect(tree.root.findByProps({ testID: 'task-routing-processing-tag' })).toBeTruthy()
    })

    it('announces what is happening to screen readers even though it shows no text', async () => {
        // The badge is deliberately icon-only — the trailing tag area is the tightest space on the
        // row. That trade is only acceptable because the meaning survives in the accessibility label.
        const tree = await render(
            <TaskRoutingTag processing={{ subject: 'goal' }} confirmation={null} projectName="Alldone" />
        )
        const tag = tree.root.findByProps({ testID: 'task-routing-processing-tag' })

        expect(tag.props.accessibilityLabel).toBe('Finding a matching goal')
        expect(tag.props.accessibilityLiveRegion).toBe('polite')
    })

    it('names the project a moved task landed in', async () => {
        const tree = await render(
            <TaskRoutingTag
                processing={null}
                confirmation={{ subject: 'project', fromProjectId: 'other' }}
                projectName="Alldone Product"
            />
        )

        expect(confirmationLabel(tree)).toBe('Moved to Alldone Product')
    })

    it('falls back to a readable phrase when the project name is not resolvable', async () => {
        const tree = await render(
            <TaskRoutingTag processing={null} confirmation={{ subject: 'project' }} projectName="" />
        )

        expect(confirmationLabel(tree)).toBe('Moved to this project')
    })

    it('confirms a goal without repeating the goal name the row already shows', async () => {
        // The row renders its own GoalTag as soon as parentGoalId is set, so naming the goal here
        // would say the same thing twice and cost a second goal watcher to do it.
        const tree = await render(
            <TaskRoutingTag processing={null} confirmation={{ subject: 'goal', goalId: 'g1' }} projectName="Alldone" />
        )

        expect(confirmationLabel(tree)).toBe('Added to goal')
    })

    it('lets the confirmation win when both states are somehow passed', async () => {
        const tree = await render(
            <TaskRoutingTag
                processing={{ subject: 'project' }}
                confirmation={{ subject: 'goal' }}
                projectName="Alldone"
            />
        )

        expect(tree.root.findAllByProps({ testID: 'task-routing-processing-tag' })).toHaveLength(0)
        expect(tree.root.findByProps({ testID: 'task-routing-confirmation-tag' })).toBeTruthy()
    })

    it('still renders the badge under reduced motion', async () => {
        // Reduced motion removes the MOTION, never the message: the badge and its accessibility
        // label are the information, and a user who prefers less movement still needs them.
        AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))

        const tree = await render(
            <TaskRoutingTag processing={{ subject: 'project' }} confirmation={null} projectName="Alldone" />
        )

        expect(tree.root.findByProps({ testID: 'task-routing-processing-tag' })).toBeTruthy()
    })
})
