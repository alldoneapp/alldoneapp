import React from 'react'
import { createRoot } from 'react-dom/client'
import AnnaShell from '../../components/Anna/AnnaShell'
import { setAnnaMode } from '../../utils/annaMode'
window.zoomAnna = setAnnaMode
setAnnaMode(true)
createRoot(document.getElementById('root')).render(
    <AnnaShell routeId="fixture-note">
        <div style={{ flex: 1, minWidth: 0, padding: '32px', background: 'white', overflow: 'auto' }}>
            <span style={{ color: '#73827e', font: '14px Arial' }}>Launch / Task notes · editable fixture</span>
            <h1 style={{ font: '28px Arial', color: '#243c38' }}>Prepare the launch</h1>
            <p style={{ font: '16px Arial', lineHeight: 1.6 }}>
                This fixture represents the same mounted Alldone editor in either layout.
            </p>
            <textarea
                aria-label="Workspace draft"
                defaultValue="Launch notes: confirm the date with the team."
                style={{ width: '100%', minHeight: 180, boxSizing: 'border-box', font: '16px Arial', padding: 20 }}
            />
            <button onClick={() => setAnnaMode(true)}>Zoom out to assistant</button>
        </div>
    </AnnaShell>
)
