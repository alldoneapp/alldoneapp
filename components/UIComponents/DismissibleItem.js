import React, { Component } from 'react'
import PropTypes from 'prop-types'

import MyPlatform from '../MyPlatform'
import store from '../../redux/store'
import { setDismissibleComponent, toggleDismissibleActive, unsetAddTaskRepeatMode } from '../../redux/actions'
import DismissibleModal from './DismissibleModal'
import { dismissAllPopups } from '../../utils/HelperFunctions'

class DismissibleItem extends Component {
    _isMounted = false

    constructor(props) {
        super(props)
        const storeState = store.getState()

        this.state = {
            dismissibleActive: storeState.dismissibleActive,
            visibleModal: false,
        }
    }

    componentDidMount() {
        this.unsubscribe = store.subscribe(this.updateState)
        this._isMounted = true
    }

    componentDidUpdate(prevProps, prevState, snapshot) {
        if (MyPlatform.isMobile) {
            // If edit mode is enabled and dismissible is not active
            // then change the visibleModal as disabled
            if (this.state.visibleModal && !this.state.dismissibleActive) {
                this.setState({ visibleModal: false })
            }
        }

        const storeState = store.getState()
        if (
            this.state.visibleModal &&
            !storeState.showConfirmPopupData.visible &&
            storeState.showConfirmPopupData.trigger !== null
        ) {
            this.setState({ visibleModal: false })
        }
    }

    componentWillUnmount() {
        this._isMounted = false
        this.unsubscribe()
    }

    updateState = () => {
        if (!this._isMounted) return
        const { dismissibleActive } = store.getState()
        if (dismissibleActive !== this.state.dismissibleActive) {
            this.setState({
                dismissibleActive: store.getState().dismissibleActive,
            })
        }
    }

    modalIsVisible = () => {
        const { visibleModal } = this.state
        return visibleModal
    }

    toggleModal = forceAction => {
        const { visibleModal } = this.state
        const { onToggleModal } = this.props

        if (forceAction || store.getState().showFloatPopup === 0) {
            if (MyPlatform.isMobile) {
                // Set dismissible as active
                store.dispatch(toggleDismissibleActive(!visibleModal))

                // If edit mode is disabled, then deactivate the dismissible
                // and Reset dismissible Ref on redux store
                if (visibleModal) {
                    store.dispatch([toggleDismissibleActive(false), setDismissibleComponent(null)])
                }
            }

            this.setState({ visibleModal: !visibleModal })

            if (onToggleModal !== undefined) {
                onToggleModal(!visibleModal)
            }
        } else {
            dismissAllPopups(true, true)
        }
    }

    openModal = forceAction => {
        const { visibleModal } = this.state
        const { onToggleModal } = this.props

        if (forceAction || store.getState().showFloatPopup === 0) {
            if (MyPlatform.isMobile) {
                // Set dismissible as active
                store.dispatch(toggleDismissibleActive(true))

                // If edit mode is disabled, then deactivate the dismissible
                // and Reset dismissible Ref on redux store
                if (visibleModal) {
                    store.dispatch([toggleDismissibleActive(false), setDismissibleComponent(null)])
                }
            }

            this.setState({ visibleModal: true })
        }

        if (onToggleModal !== undefined) {
            onToggleModal(true)
        }
    }

    closeModal = (success, forceAction) => {
        const { visibleModal } = this.state
        const { onToggleModal } = this.props

        if (forceAction || store.getState().showFloatPopup === 0) {
            if (MyPlatform.isMobile) {
                // Set dismissible as active
                store.dispatch(toggleDismissibleActive(false))

                // If edit mode is disabled, then deactivate the dismissible
                // and Reset dismissible Ref on redux store
                if (visibleModal) {
                    store.dispatch([toggleDismissibleActive(false), setDismissibleComponent(null)])
                }
            }

            this.setState({ visibleModal: false })
        }

        if (onToggleModal !== undefined) {
            onToggleModal(false, success)
        }
    }

    onDismiss = () => {
        if (store.getState().addTaskRepeatMode) {
            store.dispatch(unsetAddTaskRepeatMode())
        }
        this.toggleModal()
    }

    render() {
        const { visibleModal, dismissibleActive } = this.state

        return visibleModal && ((MyPlatform.isMobile && dismissibleActive) || !MyPlatform.isMobile) ? (
            <DismissibleModal onDismiss={this.onDismiss} visibleModal={visibleModal}>
                {this.props.modalComponent}
            </DismissibleModal>
        ) : (
            this.props.defaultComponent
        )
    }
}

DismissibleItem.propTypes = {
    defaultComponent: PropTypes.element.isRequired,
    modalComponent: PropTypes.element.isRequired,
    onToggleModal: PropTypes.func,
}

export default DismissibleItem
