import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import WorkspaceOverlayLayer from '../../components/UIComponents/WorkspaceOverlayLayer'
import EndDayStatisticsModal from '../../components/UIComponents/FloatModals/EndDayStatisticsModal'
import {
    CONFIRM_POPUP_MANDATORY_NOTIFICATION,
    CONFIRM_POPUP_TRIGGER_INFO,
    CONFIRM_POPUP_TIMEOUT,
} from '../../components/UIComponents/ConfirmPopup'
import GlobalModalsContainerApp from '../../components/UIComponents/GlobalModalsContainerApp'
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
            showOptionalVersionNotification: name === 'optional',
            showConfirmPopupData: {
                visible: ['mandatory', 'timeout', 'confirmation'].includes(name),
                trigger:
                    name === 'mandatory'
                        ? CONFIRM_POPUP_MANDATORY_NOTIFICATION
                        : name === 'timeout'
                          ? CONFIRM_POPUP_TIMEOUT
                          : CONFIRM_POPUP_TRIGGER_INFO,
                object: { headerText: 'Confirm browser check' },
            },
        },
    })
}

function Harness() {
    return (
        <Provider store={store}>
            <div style={{ position: 'fixed', inset: 0, background: '#edf2fa' }}>
                <aside style={{ position: 'absolute', top: 60, bottom: 0, width: '40%', background: '#d5e1f5' }}>
                    Assistant sidebar
                </aside>
            </div>
            <GlobalModalsContainerApp />
            <WorkspaceOverlayLayer>
                <EndDayStatisticsModal />
            </WorkspaceOverlayLayer>
        </Provider>
    )
}

const root = createRoot(document.getElementById('root'))
root.render(<Harness />)
