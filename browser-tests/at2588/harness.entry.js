import React from 'react'
import { createRoot } from 'react-dom/client'

import IntegrationsLinkProperty from '../../components/ProjectDetailedView/ProjectProperties/IntegrationsLink/IntegrationsLinkProperty'

const width = Number(new URLSearchParams(window.location.search).get('width') || 864)

const rect = element => {
    const { left, right, top, bottom, width: measuredWidth, height } = element.getBoundingClientRect()
    return { left, right, top, bottom, width: measuredWidth, height, centerY: top + height / 2 }
}

function Harness() {
    return (
        <div style={{ width }}>
            <IntegrationsLinkProperty />
        </div>
    )
}

createRoot(document.getElementById('root')).render(<Harness />)

window.__measure = () => {
    const row = document.querySelector('[data-testid="email-calendar-property-row"]')
    const label = document.querySelector('[data-testid="email-calendar-property-label"]')
    const link = document.querySelector('[data-testid="email-calendar-property-link"]')
    const linkText = document.querySelector('[data-testid="email-calendar-property-link-text"]')
    if (!row || !label || !link || !linkText) return null

    const computedLinkText = getComputedStyle(linkText)
    return {
        row: rect(row),
        label: rect(label),
        link: rect(link),
        linkText: rect(linkText),
        fontFamily: computedLinkText.fontFamily,
        fontSize: computedLinkText.fontSize,
        fontWeight: computedLinkText.fontWeight,
    }
}

window.__ready = true
