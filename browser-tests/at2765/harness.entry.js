import React from 'react'
import { createRoot } from 'react-dom/client'
import VoiceCallConnecting from '../../components/UIComponents/VoiceCallConnecting'
import iconFont from '../../assets/fonts/alldone.ttf'
import regularFont from '../../assets/fonts/Roboto-Regular.ttf'
import mediumFont from '../../assets/fonts/Roboto-Medium.ttf'

const fontStyle = document.createElement('style')
fontStyle.textContent = `
    @font-face { font-family: alldone; src: url('${iconFont}'); }
    @font-face { font-family: Roboto-Regular; src: url('${regularFont}'); }
    @font-face { font-family: Roboto-Medium; src: url('${mediumFont}'); }
`
document.head.appendChild(fontStyle)

// Render the shipped component and styles, without a paid call or microphone.
document.body.style.cssText = 'margin: 0; padding: 24px; background: #f7f9fb; font-family: Arial;'
const mount = document.createElement('div')
document.body.appendChild(mount)
createRoot(mount).render(
    <main style={{ maxWidth: 440, margin: '40px auto', padding: 16, background: 'white', borderRadius: 20 }}>
        <VoiceCallConnecting assistantName="Anna" />
    </main>
)
