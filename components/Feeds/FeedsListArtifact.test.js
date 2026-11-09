import React from 'react'
import renderer, { act } from 'react-test-renderer'
import moment from 'moment'

// A function declaration, so it exists when the hoisted mocks run.
function mockObject(name) {
    const { Text: MockText } = require('react-native')
    return ({ feedObjectData }) => <MockText testID={name}>{feedObjectData.object.id}</MockText>
}
jest.mock('./FeedsObjects/ContactObject', () => mockObject('contact'))
jest.mock('./FeedsObjects/TaskObject', () => mockObject('task'))
jest.mock('./FeedsObjects/GoalObject', () => mockObject('goal'))
jest.mock('./FeedsObjects/ProjectObject', () => mockObject('project'))
jest.mock('./FeedsObjects/UserObject', () => mockObject('user'))
jest.mock('./FeedsObjects/NoteObject', () => mockObject('note'))
jest.mock('./FeedsObjects/SkillObject', () => mockObject('skill'))
jest.mock('./FeedsObjects/AssistantObject', () => mockObject('assistant'))
jest.mock('./FeedsObjects/WikiObject', () => mockObject('wiki'))
jest.mock('./FeedsObjects/ArtifactObject', () => mockObject('artifact'))
jest.mock('./Commons/DateLine', () => () => null)

import FeedsList from './FeedsList'

// An artifact card in Updates is drawn by ArtifactObject (functions/Artifacts/artifactFeeds.js).
it('draws an artifact card with the artifact object', () => {
    let tree
    act(() => {
        tree = renderer.create(
            <FeedsList
                projectId="p1"
                date={moment()}
                feedActiveTab={1}
                feedViewData={{ type: 'project' }}
                feedObjects={[
                    { object: { id: 'a1', type: 'artifact' }, feeds: [] },
                    { object: { id: 'n1', type: 'note' }, feeds: [] },
                ]}
            />
        )
    })
    const drawn = testID => tree.root.findAllByProps({ testID }, { deep: false }).map(node => node.props.children)
    expect(drawn('artifact')).toEqual(['a1'])
    expect(drawn('note')).toEqual(['n1'])
    act(() => tree.unmount())
})
