/**
 * @jest-environment jsdom
 */

import React from 'react'
import MentionsModal from '../../../components/Feeds/CommentsTextInput/MentionsModal'

import renderer from 'react-test-renderer'

jest.mock('react-redux', () => ({
    ...jest.requireActual('react-redux'),
    useSelector: jest.fn().mockImplementation(fnc => {
        return fnc({
            projectsUsers: [
                [
                    { uid: 0, displayName: 'pepe' },
                    { uid: 1, displayName: 'pedro' },
                    { uid: 2, displayName: 'pero' },
                    { uid: 3, displayName: 'pepe' },
                ],
            ],
            selectedProjectIndex: 0,
        })
    }),
}))
jest.mock('../../../components/MyPlatform', () => ({
    isMobile: false,
}))

describe('MentionsModal component', () => {
    it('should render correctly', () => {
        const tree = renderer.create(<MentionsModal mentionText="pe" projectIndex={0} />)
        tree.update(<MentionsModal mentionText="juan" />)
        expect(tree.toJSON()).toMatchSnapshot()
    })
})
