import ErrorBoundary from './ErrorBoundary'
import Backend from './BackendBridge'
import { reportFatalFirestoreError } from './firestoreFatalRecovery'

jest.mock('../components/ErrorBoundaryPage/ErrorBoundaryPage', () => 'ErrorBoundaryPage')
jest.mock('./BackendBridge', () => ({
    registerError: jest.fn(),
}))
jest.mock('./firestoreFatalRecovery', () => ({
    reportFatalFirestoreError: jest.fn(),
}))

describe('ErrorBoundary Firestore recovery', () => {
    beforeEach(() => {
        jest.clearAllMocks()
        jest.spyOn(console, 'log').mockImplementation(() => {})
    })

    afterEach(() => {
        console.log.mockRestore()
    })

    it('does not try to report a fatal Firestore queue assertion back through the poisoned queue', () => {
        const error = new Error('fatal firestore queue')
        reportFatalFirestoreError.mockReturnValue(true)

        new ErrorBoundary({}).componentDidCatch(error, {})

        expect(reportFatalFirestoreError).toHaveBeenCalledWith(error)
        expect(Backend.registerError).not.toHaveBeenCalled()
    })

    it('keeps the existing runtime error report for ordinary render failures', () => {
        const error = new Error('ordinary render failure')
        reportFatalFirestoreError.mockReturnValue(false)

        new ErrorBoundary({}).componentDidCatch(error, {})

        expect(Backend.registerError).toHaveBeenCalledWith(error)
    })
})
