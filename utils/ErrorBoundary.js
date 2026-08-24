import React, { Component } from 'react'
import ErrorBoundaryPage from '../components/ErrorBoundaryPage/ErrorBoundaryPage'
import Backend from './BackendBridge'
import { reportFatalFirestoreError } from './firestoreFatalRecovery'

class ErrorBoundary extends Component {
    constructor(props) {
        super(props)

        this.state = {
            hasError: false,
        }
    }

    static getDerivedStateFromError = error => {
        return { hasError: true }
    }

    componentDidCatch = (error, info) => {
        console.log(error, info)
        // Firestore cannot record its own fatal AsyncQueue assertion: attempting
        // that write only throws b815 again. The global recovery handler reloads
        // the poisoned client and the original error remains available to Sentry.
        if (!reportFatalFirestoreError(error)) Backend.registerError(error)
    }

    render() {
        const { hasError } = this.state
        const { children } = this.props

        return hasError ? <ErrorBoundaryPage /> : children
    }
}

export default ErrorBoundary
