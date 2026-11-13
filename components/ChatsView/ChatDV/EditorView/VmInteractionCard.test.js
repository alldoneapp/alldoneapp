import React from 'react'
import { act, fireEvent, render } from '@testing-library/react'

import VmInteractionCard from './VmInteractionCard'
import { DARK_PALETTE, LIGHT_PALETTE, PAGE_PALETTE_SCOPE_ATTRIBUTE } from '../../../../Themes/colorMode'

const mockRespond = jest.fn(() => Promise.resolve())
jest.mock('../../../../utils/backends/Assistants/assistantRuns', () => ({
    respondToVmInteraction: (...args) => mockRespond(...args),
}))

const clarificationRun = {
    runId: 'run-1',
    interaction: {
        requestId: 'req-1',
        kind: 'clarification',
        questions: [
            {
                id: 'devices',
                header: 'Geräte',
                question: 'Wie soll das im Call-Panel sein?',
                options: [
                    { label: 'Wie Assistant Mode', description: 'Kompakter' },
                    { label: 'Dropdowns sichtbar lassen' },
                ],
            },
        ],
    },
}

const renderInPopup = run => {
    // The task comment popup marks its content with the popup scope, which keeps the light
    // palette in dark mode. The card has to opt back into the page palette inside it.
    const popup = document.createElement('div')
    popup.setAttribute('data-ad-popup', 'true')
    document.body.appendChild(popup)
    return render(
        <VmInteractionCard projectId="p1" objectType="tasks" objectId="t1" commentId="c1" assistantRun={run} />,
        { container: popup }
    )
}

beforeEach(() => {
    mockRespond.mockClear()
    document.body.innerHTML = ''
})

it('opts its root back into the page palette, so it turns dark inside a dark-mode popup', () => {
    const { container, getByText } = renderInPopup(clarificationRun)
    const card = container.querySelector(`[${PAGE_PALETTE_SCOPE_ATTRIBUTE}]`)
    expect(card).not.toBeNull()
    expect(card.contains(getByText('QUESTION'))).toBe(true)
    expect(card.contains(getByText('Geräte'))).toBe(true)
})

it('keeps the clarification interaction: select an option, type another answer, send', async () => {
    const { getByText, getByPlaceholderText } = renderInPopup(clarificationRun)
    fireEvent.click(getByText('Dropdowns sichtbar lassen'))
    const other = getByPlaceholderText('Type another answer…')
    fireEvent.focus(other)
    fireEvent.change(other, { target: { value: 'Beides' } })
    fireEvent.blur(other)
    await act(async () => {
        fireEvent.click(getByText('Send answers'))
    })
    expect(mockRespond).toHaveBeenCalledWith(
        expect.objectContaining({
            runId: 'run-1',
            requestId: 'req-1',
            response: {
                action: 'submit',
                answers: { devices: ['Dropdowns sichtbar lassen'], 'devices:other': 'Beides' },
                message: '',
            },
        })
    )
})

it('marks the approval card the same way', () => {
    const { container } = renderInPopup({
        runId: 'run-2',
        interaction: { requestId: 'req-2', kind: 'tool_approval', toolName: 'Bash', command: 'npm test' },
    })
    expect(container.querySelector(`[${PAGE_PALETTE_SCOPE_ATTRIBUTE}]`)).not.toBeNull()
    expect(container.querySelector('textarea').getAttribute('placeholder')).toBe('Optional instruction or reason…')
})

it('the selected option label reads on both tints (AccentText is Primary300 in light mode)', () => {
    expect(LIGHT_PALETTE.AccentText).toBe('#0D55CF')
    expect(DARK_PALETTE.AccentText).not.toBe(LIGHT_PALETTE.AccentText)
})
