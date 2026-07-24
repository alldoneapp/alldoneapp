import React, { Component } from 'react'
import { View } from 'react-native'
import MyPlatform from '../MyPlatform'
import store from '../../redux/store'
import {
    hideAddProjectOptions,
    hideAssigneePicker,
    hideDueDateCalendar,
    hideInviteUserOptions,
    hideProjectColorPicker,
    hideProjectPicker,
    hideWebSideBar,
    setDismissibleComponent,
    toggleDismissibleActive,
} from '../../redux/actions'
import { Dismissible } from 'react-dismissible'
import PropTypes from 'prop-types'

class DismissibleModal extends Component {
    _isMounted = false

    constructor(props) {
        super(props)
        this.updateState = this.updateState.bind(this)

        const storeState = store.getState()

        this.state = {
            showConfirmPopupData: storeState.showConfirmPopupData,
            showFloatPopup: storeState.showFloatPopup,
            unsubscribe: store.subscribe(this.updateState),
        }

        this.dismissibleModal = React.createRef()
    }

    componentDidMount() {
        this._isMounted = true
        store.dispatch(setDismissibleComponent(this.dismissibleModal.current))
    }

    shouldComponentUpdate(nextProps, nextState, nextContext) {
        return nextProps.visibleModal && (this.state.showFloatPopup > 0 || nextState.showFloatPopup > 0)
    }

    componentWillUnmount() {
        this._isMounted = false
        this.state.unsubscribe()
    }

    updateState() {
        if (!this._isMounted) return
        const storeState = store.getState()

        this.setState({
            showConfirmPopupData: storeState.showConfirmPopupData,
            showFloatPopup: storeState.showFloatPopup,
        })
    }

    render() {
        const popupVisible =
            this.props.visibleModal && (this.state.showConfirmPopupData.visible || this.state.showFloatPopup > 0)
        return (
            <View ref={this.dismissibleModal}>
                {MyPlatform.isMobile ? (
                    this.props.children
                ) : (
                    <View accessibilityLabel={'dismissible-edit-item'}>
                        <Dismissible
                            disabled={popupVisible}
                            click={true}
                            escape={true}
                            onDismiss={this.props.onDismiss}
                        >
                            {this.props.children}
                        </Dismissible>
                    </View>
                )}
            </View>
        )
    }

    /**
     * Return the limit coordinates of the Dismissible component
     * saved in 'dismissibleComponent' of redux store
     *
     * @returns {Promise<unknown>}
     */
    static async getDismissibleLimits() {
        const { dismissibleComponent } = store.getState()

        if (dismissibleComponent === null) return null

        return new Promise(async resolve => {
            await dismissibleComponent.measureInWindow(async (x, y, width, height) => {
                resolve({
                    x1: x,
                    x2: x + width,
                    y1: y,
                    y2: y + height,
                })
            })
        })
    }

    /**
     * Find if a touch is outside the 'dismissibleComponent' limit coordinates
     * If TRUE, then Reset dismissible properties in redux store (the dismiss action)
     * If FALSE, then return the touch event
     *
     * This function should be used as callback for the 'onStartShouldSetResponderCapture'
     * in the Views that will be used as dismissible backdrop
     *
     * @param event
     */
    static captureDismissibleTouch(event) {
        event.persist()
        const { pageX, pageY } = event.nativeEvent

        DismissibleModal.getDismissibleLimits()
            .then(disCmp => {
                if (
                    disCmp === null ||
                    (disCmp.x1 <= pageX && pageX <= disCmp.x2 && disCmp.y1 <= pageY && pageY <= disCmp.y2)
                ) {
                    return
                }
                store.dispatch([toggleDismissibleActive(false), setDismissibleComponent(null)])
            })
            .catch(console.log)

        const storeState = store.getState()
        const showAddProjectOptions = storeState.showAddProjectOptions
        const showInviteUserOptions = storeState.showInviteUserOptions
        const showProjectColorPicker = storeState.showProjectColorPicker
        const showAssigneePicker = storeState.showAssigneePicker
        const showProjectPicker = storeState.showProjectPicker
        const showDueDateCalendar = storeState.showDueDateCalendar

        if (!MyPlatform.isMobile && storeState.smallScreenNavigation && storeState.showWebSideBar.visible) {
            const sideBarLayout = storeState.showWebSideBar.layout
            if (
                DismissibleModal.isTouchOutside(pageX, pageY, {
                    x: sideBarLayout.x,
                    y: sideBarLayout.y,
                    width: sideBarLayout.width,
                    height: sideBarLayout.height,
                })
            ) {
                store.dispatch(hideWebSideBar())
            }
        }

        if (showAddProjectOptions.visible) {
            if (showProjectColorPicker.visible) {
                if (
                    DismissibleModal.isTouchOutside(pageX, pageY, showAddProjectOptions.layout) &&
                    DismissibleModal.isTouchOutside(pageX, pageY, showProjectColorPicker.layout)
                ) {
                    store.dispatch([hideProjectColorPicker(), hideAddProjectOptions()])
                }
            } else {
                if (DismissibleModal.isTouchOutside(pageX, pageY, showAddProjectOptions.layout)) {
                    store.dispatch(hideAddProjectOptions())
                }
            }
        }

        if (showInviteUserOptions.visible) {
            if (DismissibleModal.isTouchOutside(pageX, pageY, showInviteUserOptions.layout)) {
                store.dispatch(hideInviteUserOptions())
            }
        }

        if (showAssigneePicker.visible && DismissibleModal.isTouchOutside(pageX, pageY, showAssigneePicker.layout))
            store.dispatch(hideAssigneePicker())

        if (showProjectPicker.visible && DismissibleModal.isTouchOutside(pageX, pageY, showProjectPicker.layout))
            store.dispatch(hideProjectPicker())

        if (showDueDateCalendar.visible && DismissibleModal.isTouchOutside(pageX, pageY, showDueDateCalendar.layout))
            store.dispatch(hideDueDateCalendar())
    }

    static isTouchOutside(touchX, touchY, layout) {
        const toX = layout.x + layout.width
        const toY = layout.y + layout.height

        return touchX <= layout.x || touchX >= toX || touchY <= layout.y || touchY >= toY
    }
}

DismissibleModal.propTypes = {
    onDismiss: PropTypes.func.isRequired,
    visibleModal: PropTypes.bool,
}

DismissibleModal.defaultProps = {
    visibleModal: false,
}

export default DismissibleModal
