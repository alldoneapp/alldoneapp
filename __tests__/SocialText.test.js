import React from 'react'
import SocialText from '../components/UIControls/SocialText'

import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }));

const testString = '@mention #hashtag email@gmail.com https://a.com Normal text'
describe('SocialText component', () => {
    describe('SocialText snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<SocialText>{testString}</SocialText>).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
