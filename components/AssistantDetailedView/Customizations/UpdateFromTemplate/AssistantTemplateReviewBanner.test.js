import React from 'react'
import renderer from 'react-test-renderer'

jest.mock('../../../../i18n/TranslationService', () => ({
    ...jest.requireActual('../../../../i18n/TranslationService'),
    translate: key => key,
}))
// Button subscribes to the real redux store in its constructor; the host stub
// keeps the props inspectable (title/onPress) without booting the store.
jest.mock('../../../UIControls/Button', () => 'Button')

const AssistantTemplateReviewBanner = require('./AssistantTemplateReviewBanner').default

const LINKED = 'template-1'

const render = (assistant, onReview) =>
    renderer.create(<AssistantTemplateReviewBanner assistant={assistant} onReview={onReview} />)

// react-native maps to react-native-web here, so <Text> is not a host element
// named 'Text' — walking the rendered output is what actually reads the copy.
const collect = (node, found) => {
    if (typeof node === 'string') found.push(node)
    else if (Array.isArray(node)) node.forEach(child => collect(child, found))
    else if (node && node.children) collect(node.children, found)
    return found
}

const texts = tree => collect(tree.toJSON(), [])

describe('assistant board template review banner (AT-2425)', () => {
    it('names what changed and points at Edit', () => {
        const tree = render({
            copiedFromTemplateAssistantId: LINKED,
            templateSyncConflicts: [{ field: 'instructions' }, { field: 'model' }],
        })

        const copy = texts(tree)
        expect(copy).toContain("This assistant's template was updated")
        // The count line reuses the sidebar's exact phrasing, then names the settings.
        expect(copy).toContain('2 template changes need review: Instructions, Assistant model')
        expect(copy).toContain('Click Edit to choose which version to keep.')
    })

    it('uses the singular label for a single pending change', () => {
        const tree = render({
            copiedFromTemplateAssistantId: LINKED,
            templateSyncConflicts: [{ field: 'model' }],
        })

        expect(texts(tree)).toContain('1 template change needs review: Assistant model')
    })

    it('renders nothing once the conflicts are resolved', () => {
        const tree = renderer.create(
            <AssistantTemplateReviewBanner
                assistant={{ copiedFromTemplateAssistantId: LINKED, templateSyncConflicts: [] }}
            />
        )
        expect(tree.toJSON()).toBeNull()
    })

    it('renders nothing for an assistant that is not linked to a template', () => {
        // Same gate as the sidebar: a stale conflicts array on an unlinked
        // assistant would point at a resolve panel that renders nothing.
        const tree = renderer.create(
            <AssistantTemplateReviewBanner assistant={{ templateSyncConflicts: [{ field: 'model' }] }} />
        )
        expect(tree.toJSON()).toBeNull()
    })

    it('survives a missing or malformed assistant without throwing', () => {
        expect(renderer.create(<AssistantTemplateReviewBanner assistant={undefined} />).toJSON()).toBeNull()
        expect(renderer.create(<AssistantTemplateReviewBanner assistant={null} />).toJSON()).toBeNull()
        expect(
            renderer
                .create(
                    <AssistantTemplateReviewBanner
                        assistant={{ copiedFromTemplateAssistantId: LINKED, templateSyncConflicts: 'nope' }}
                    />
                )
                .toJSON()
        ).toBeNull()
    })

    it('falls back to the bare count when no conflict field can be named', () => {
        const tree = render({
            copiedFromTemplateAssistantId: LINKED,
            templateSyncConflicts: [{ field: '' }, {}],
        })

        // No dangling "2 template changes need review: " with an empty list.
        expect(texts(tree)).toContain('2 template changes need review')
    })

    it('does not repeat a setting name that two raw fields map onto', () => {
        const tree = render({
            copiedFromTemplateAssistantId: LINKED,
            templateSyncConflicts: [{ field: 'email_signature' }, { field: 'emailSignature' }],
        })

        expect(texts(tree)).toContain('2 template changes need review: Email signature')
    })

    it('opens the editor from the review action', () => {
        const onReview = jest.fn()
        const root = render(
            { copiedFromTemplateAssistantId: LINKED, templateSyncConflicts: [{ field: 'model' }] },
            onReview
        ).root

        const buttons = root.findAllByType('Button', { deep: false })
        expect(buttons).toHaveLength(1)
        expect(buttons[0].props.title).toBe('Review changes')
        buttons[0].props.onPress()
        expect(onReview).toHaveBeenCalledTimes(1)
    })

    it('drops the action when there is nowhere to send the user', () => {
        const root = render({ copiedFromTemplateAssistantId: LINKED, templateSyncConflicts: [{ field: 'model' }] }).root
        expect(root.findAllByType('Button', { deep: false })).toHaveLength(0)
    })

    it('carries the review count as an accessibility label, like the sidebar marker', () => {
        const root = render({
            copiedFromTemplateAssistantId: LINKED,
            templateSyncConflicts: [{ field: 'model' }, { field: 'displayName' }],
        }).root

        expect(
            root.findAllByProps({ accessibilityLabel: '2 template changes need review' }, { deep: true }).length
        ).toBeGreaterThan(0)
    })
})
