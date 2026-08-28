import React from 'react'
import { AccessibilityInfo } from 'react-native'
import renderer, { act } from 'react-test-renderer'

import TaskRoutingTag, { RoutingSparkle } from './TaskRoutingTag'

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

    it('announces the full sentence to screen readers, not the short visible token', async () => {
        // The visible label is a glance-value abbreviation; "(goal?)" is a poor thing to hear
        // announced, so the accessibility label keeps the sentence it abbreviates.
        const tree = await render(
            <TaskRoutingTag processing={{ subject: 'goal' }} confirmation={null} projectName="Alldone" />
        )
        const tag = tree.root.findByProps({ testID: 'task-routing-processing-tag' })

        expect(tag.props.accessibilityLabel).toBe('Finding a matching goal')
        expect(tag.props.accessibilityLiveRegion).toBe('polite')
    })

    /**
     * AT-2453 follow-up — the badge names what is being looked up.
     *
     * Before this it was a lone sparkle, which said "something is happening" and nothing else. The
     * two subjects have very different consequences for the user — one MOVES the task to another
     * project, the other only files it under a goal — so which one is running is the useful half of
     * the message, and it is now the visible half.
     */
    describe('the processing badge names its subject', () => {
        const subjectLabel = tree => tree.root.findByProps({ testID: 'task-routing-processing-subject' }).props.children

        it('asks "(project?)" while the project router is deciding', async () => {
            const tree = await render(
                <TaskRoutingTag processing={{ subject: 'project' }} confirmation={null} projectName="Alldone" />
            )

            expect(subjectLabel(tree)).toBe('(project?)')
        })

        it('asks "(goal?)" while the goal router is deciding', async () => {
            const tree = await render(
                <TaskRoutingTag processing={{ subject: 'goal' }} confirmation={null} projectName="Alldone" />
            )

            expect(subjectLabel(tree)).toBe('(goal?)')
        })

        it('keeps the sparkle beside the label rather than replacing it', async () => {
            const tree = await render(
                <TaskRoutingTag processing={{ subject: 'project' }} confirmation={null} projectName="Alldone" />
            )

            expect(tree.root.findAllByType(RoutingSparkle)).toHaveLength(1)
        })

        it('still names its subject under reduced motion', async () => {
            // The sparkle stops twinkling; the word is information and must survive.
            AccessibilityInfo.isReduceMotionEnabled = jest.fn(() => Promise.resolve(true))

            const tree = await render(
                <TaskRoutingTag processing={{ subject: 'goal' }} confirmation={null} projectName="Alldone" />
            )

            expect(subjectLabel(tree)).toBe('(goal?)')
        })

        it('truncates to one line instead of widening the tag row without bound', async () => {
            // The trailing tag area is shared with the title on a phone. A label that wrapped or
            // grew freely would push the tags over the title for the whole classification.
            const tree = await render(
                <TaskRoutingTag processing={{ subject: 'project' }} confirmation={null} projectName="Alldone" />
            )
            const label = tree.root.findByProps({ testID: 'task-routing-processing-subject' })
            const tag = tree.root.findByProps({ testID: 'task-routing-processing-tag' })
            const tagStyle = Object.assign({}, ...[].concat(tag.props.style).filter(Boolean))

            expect(label.props.numberOfLines).toBe(1)
            expect(tagStyle.flexShrink).toBe(1)
            expect(tagStyle.maxWidth).toBeLessThanOrEqual(140)
            // The old icon-only badge pinned itself to a 24px circle, which would now clip the label.
            expect(tagStyle.width).toBeUndefined()
        })

        it('carries no subject label once the decision is confirmed', async () => {
            const tree = await render(
                <TaskRoutingTag processing={null} confirmation={{ subject: 'project' }} projectName="Alldone" />
            )

            expect(tree.root.findAllByProps({ testID: 'task-routing-processing-subject' })).toHaveLength(0)
        })
    })

    it('translates the subject token as one phrase, brackets and all', () => {
        // Spanish opens with "¿", so the punctuation is part of the phrase rather than something a
        // template could wrap around a translated noun. Asserted against the real files so a
        // half-added key fails here instead of shipping a literal "(project?)" to a German user.
        const de = require('../../i18n/translations/de.json')
        const es = require('../../i18n/translations/es.json')

        expect(de['(project?)']).toBe('(Projekt?)')
        expect(de['(goal?)']).toBe('(Ziel?)')
        expect(es['(project?)']).toBe('(¿proyecto?)')
        expect(es['(goal?)']).toBe('(¿objetivo?)')
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
