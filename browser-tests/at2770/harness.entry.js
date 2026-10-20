import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider, useSelector } from 'react-redux'
import WorkspaceOverlayLayer from '../../components/UIComponents/WorkspaceOverlayLayer'
import EndDayStatisticsModal from '../../components/UIComponents/FloatModals/EndDayStatisticsModal'
import ConfirmPopup, {
    CONFIRM_POPUP_MANDATORY_NOTIFICATION,
    CONFIRM_POPUP_TRIGGER_INFO,
} from '../../components/UIComponents/ConfirmPopup'
import NotificationModalOptional from '../../components/UIComponents/FloatModals/NotificationModalOptional'
import { setAnnaLayout } from '../../utils/annaMode'
import { setWorkspaceViewport } from '../../utils/workspaceViewport'
import { store } from './dependencies'
import regularFont from '../../assets/fonts/Roboto-Regular.ttf'
import iconFont from '../../assets/fonts/alldone.ttf'

const style = document.createElement('style')
style.textContent = `
    @font-face { font-family: Roboto-Regular; src: url('${regularFont}'); }
    @font-face { font-family: alldone; src: url('${iconFont}'); }
    html, body, #root { height: 100%; margin: 0; }
    body { font-family: Roboto-Regular; }
`
document.head.appendChild(style)

window.layout = layout => {
    setAnnaLayout(layout)
    setWorkspaceViewport(
        layout === 'alldone'
            ? null
            : {
                  top: 60,
                  left: Math.floor(innerWidth * 0.4),
                  width: Math.ceil(innerWidth * 0.6),
                  height: innerHeight - 60,
              },
        layout !== 'chat'
    )
}
window.dialog = name => {
    store.dispatch({
        type: 'fixture',
        patch: {
            showNewVersionMandtoryNotifcation: name !== 'new-day',
            showConfirmPopupData: {
                visible: name === 'mandatory' || name === 'confirmation',
                trigger: name === 'mandatory' ? CONFIRM_POPUP_MANDATORY_NOTIFICATION : CONFIRM_POPUP_TRIGGER_INFO,
                object: { headerText: 'Confirm browser check' },
            },
        },
    })
    root.render(<Harness dialog={name} />)
}

function Harness({ dialog = 'new-day' }) {
    return (
        <Provider store={store}>
            <div style={{ position: 'fixed', inset: 0, background: '#edf2fa' }}>
                <aside style={{ position: 'absolute', top: 60, bottom: 0, width: '40%', background: '#d5e1f5' }}>
                    Assistant sidebar
                </aside>
            </div>
            <WorkspaceOverlayLayer>
                <EndDayStatisticsModal />
                <Confirmation />
                {dialog === 'optional' && <NotificationModalOptional />}
            </WorkspaceOverlayLayer>
        </Provider>
    )
}

function Confirmation() {
    const visible = useSelector(state => state.showConfirmPopupData.visible)
    return visible ? <ConfirmPopup /> : null
}

const root = createRoot(document.getElementById('root'))
root.render(<Harness />)
