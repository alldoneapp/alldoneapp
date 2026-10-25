import { createContext, useContext } from 'react'

// Lets modal content ask which shell presentation it is rendered in
// ('sheet' for the mobile bottom sheet; null outside a shell). Migrated
// contents use this to relinquish their own card chrome (width, radius,
// shadow) to the shell instead of guessing from breakpoints.
export const ModalShellContext = createContext(null)

export const useModalShellPresentation = () => {
    const value = useContext(ModalShellContext)
    return value ? value.presentation : null
}
