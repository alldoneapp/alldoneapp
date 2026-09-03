import React from 'react'
import { Text } from 'react-native'
import renderer from 'react-test-renderer'

import ProjectHappinessRatingList from '../../components/ProjectHappiness/ProjectHappinessRatingList'

const makeEditor = (overrides = {}) => ({
    ratings: {},
    storedEntries: {},
    visibleComments: {},
    comments: {},
    toggleComment: jest.fn(),
    setRating: jest.fn(),
    registerCommentInput: jest.fn(),
    setComment: jest.fn(),
    saveComment: jest.fn(),
    ...overrides,
})

const PROJECT = { id: 'p1', name: 'My Long Project Name' }

const render = (props = {}) => {
    let tree
    renderer.act(() => {
        tree = renderer.create(<ProjectHappinessRatingList projects={[PROJECT]} editor={makeEditor()} {...props} />)
    })
    return tree
}

describe('ProjectHappinessRatingList', () => {
    it('renders the project name on its own row without inline badges', () => {
        const tree = render()
        const texts = tree.root.findAllByType(Text)
        const nameNode = texts.find(t => t.props.children === 'My Long Project Name')
        expect(nameNode).toBeTruthy()
        expect(nameNode.props.numberOfLines).toBe(1)
    })

    it('renders the Not rated yet status at the bottom right when not rated', () => {
        const tree = render({
            editor: makeEditor({ storedEntries: {} }),
        })
        const notRated = tree.root.findByProps({ testID: 'happinessNotRated_p1' })
        expect(notRated).toBeTruthy()
    })

    it('renders the Rated badge at the bottom right when rated', () => {
        const tree = render({
            editor: makeEditor({ storedEntries: { p1: { rating: 4 } } }),
        })
        const rated = tree.root.findByProps({ testID: 'happinessRated_p1' })
        expect(rated).toBeTruthy()
    })

    it('renders in compact mode without errors', () => {
        const tree = render({ compact: true })
        expect(tree.root.findByProps({ testID: 'happinessNotRated_p1' })).toBeTruthy()
    })
})
