import React, { Component } from 'react'
import ErrorBoundaryPage from '../components/ErrorBoundaryPage/ErrorBoundaryPage'
import Backend from './BackendBridge'

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
        Backend.registerError(error)
    }

    render() {
        const { hasError } = this.state
        const { children } = this.props

        return hasError ? <ErrorBoundaryPage /> : children
    }
}

export default ErrorBoundary
