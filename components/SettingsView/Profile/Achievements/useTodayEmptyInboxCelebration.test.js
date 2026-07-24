import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment'
import { Text } from 'react-native'

import useTodayEmptyInboxCelebration from './useTodayEmptyInboxCelebration'

function CelebrationHarness({ days, enabled = true }) {
    const runId = useTodayEmptyInboxCelebration(days, enabled)
    return <Text>{runId}</Text>
}

describe('useTodayEmptyInboxCelebration', () => {
    const todayKey = moment().format('YYYY-MM-DD')
    const yesterdayKey = moment().subtract(1, 'day').format('YYYY-MM-DD')

    it('triggers once when today is added to the persisted achievement days', () => {
        let tree
        act(() => {
            tree = renderer.create(<CelebrationHarness days={[yesterdayKey]} />)
        })
        expect(tree.root.findByType('Text').props.children).toBe(0)

        act(() => {
            tree.update(<CelebrationHarness days={[yesterdayKey, todayKey]} />)
        })
        expect(tree.root.findByType('Text').props.children).toBe(1)

        act(() => {
            tree.update(<CelebrationHarness days={[todayKey, yesterdayKey]} />)
        })
        expect(tree.root.findByType('Text').props.children).toBe(1)
    })

    it('does not replay when the view mounts after today was already achieved', () => {
        let tree
        act(() => {
            tree = renderer.create(<CelebrationHarness days={[todayKey]} />)
        })

        expect(tree.root.findByType('Text').props.children).toBe(0)
    })

    it('does not trigger outside the task-list achievement overview', () => {
        let tree
        act(() => {
            tree = renderer.create(<CelebrationHarness days={[]} enabled={false} />)
        })
        act(() => {
            tree.update(<CelebrationHarness days={[todayKey]} enabled={false} />)
        })

        expect(tree.root.findByType('Text').props.children).toBe(0)
    })
})
