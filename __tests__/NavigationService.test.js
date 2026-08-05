import NavigationService from '../utils/NavigationService'

describe('NavigationService component', () => {
    it('check that the method navigate invokes the dispatch', () => {
        const dispatchMock = jest.fn()
        const mockNavigatorRef = {
            dispatch: () => {
                dispatchMock()
            },
        }
        NavigationService.setTopLevelNavigator(mockNavigatorRef)

        NavigationService.navigate('', '')

        expect(dispatchMock.mock.calls.length).toBe(1)
    })
})
