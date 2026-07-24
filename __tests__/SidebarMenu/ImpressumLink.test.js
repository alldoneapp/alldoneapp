import React from 'react'
import ImpressumLink from '../../components/SidebarMenu/ImpressumLink'
import store from '../../redux/store'
import renderer from 'react-test-renderer'

jest.mock('firebase', () => ({ firestore: {} }))

beforeEach(() => {
    jest.mock('../../URLSystem/URLTrigger')

    mockStatic = jest.fn()
    mockStatic.mockReturnValue({
        showSideBarVersionRefresher: true,
        alldoneVersion: { major: 5, minor: 3 },
        alldoneNewVersion: { major: 5, minor: 3, isMandatory: false },
    })
    store.getState = mockStatic
})

describe('ImpressumLink component', () => {
    describe('ImpressumLink snapshot test', () => {
        it('should render correctly', () => {
            const tree = renderer.create(<ImpressumLink />).toJSON()
            expect(tree).toMatchSnapshot()
        })
    })
})
