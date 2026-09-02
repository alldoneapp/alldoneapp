/**
 * Settings → Happiness trend: every bar carries the day it stands for.
 *
 * Fourteen bars without dates read the same whether they are a fortnight of
 * consecutive days or ratings scattered over a year. The date label is what
 * makes the strip a timeline.
 */

import React from 'react'
import { Text } from 'react-native'
import renderer from 'react-test-renderer'

jest.mock('../../redux/store', () => ({
    getState: () => ({
        loggedUserProjects: [{ id: 'project-a', name: 'Alldone Product' }],
        dateFormat: undefined,
    }),
}))

import HappinessStatsPanel, { getHappinessTrendDateText } from '../../components/ProjectHappiness/HappinessStatsPanel'

const day = iso => new Date(`${iso}T00:00:00.000Z`).getTime()
const entry = (iso, rating, extra = {}) => ({
    dateKey: iso.replace(/-/g, ''),
    timestamp: day(iso),
    rating,
    projectId: 'project-a',
    ...extra,
})

const render = props => {
    let tree
    renderer.act(() => {
        tree = renderer.create(<HappinessStatsPanel {...props} />)
    })
    return tree
}

const labelText = (tree, dateKey) =>
    tree.root
        .findByProps({ testID: `happinessTrendDate_${dateKey}` })
        .findAllByType(Text)
        .map(text => String(text.props.children))
        .join('')

describe('Happiness trend dates', () => {
    it('labels each bar of a project trend with its day', () => {
        const tree = render({ entries: [entry('2026-08-17', 4), entry('2026-08-19', 2)] })

        expect(labelText(tree, '20260817')).toBe('17.08')
        expect(labelText(tree, '20260819')).toBe('19.08')
    })

    it('labels each bar of the all-projects trend too', () => {
        const tree = render({
            happinessByProject: {
                'project-a': [entry('2026-08-17', 4)],
                'project-b': [
                    entry('2026-08-17', 2, { projectId: 'project-b' }),
                    entry('2026-08-18', 5, { projectId: 'project-b' }),
                ],
            },
        })

        expect(labelText(tree, '20260817')).toBe('17.08')
        expect(labelText(tree, '20260818')).toBe('18.08')
    })

    it('formats the day without the year (the default date format is dotted)', () => {
        expect(getHappinessTrendDateText(day('2026-08-17'))).toBe('17.08')
    })
})
