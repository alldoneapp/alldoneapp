import React from 'react'
import { render } from '@testing-library/react'
import AnnaMessageBody, { streamingMarkdown } from './AnnaMessageBody'

const mockBody = jest.fn()
jest.mock('../ChatsView/ChatDV/EditorView/MessageItemBody', () => props => {
    mockBody(props)
    return <span>{props.commentText}</span>
})
beforeEach(() => mockBody.mockClear())

it('keeps open streamed code in its final block layout without changing completed markdown', () => {
    expect(streamingMarkdown('Intro\n```js\nconst ready = true;')).toBe('Intro\n```js\nconst ready = true;\n```')
    const closed = '```js\nconst ready = true;\n```\nAfter'
    expect(streamingMarkdown(closed)).toBe(closed)
    expect(streamingMarkdown('A paragraph with `inline code`.')).toBe('A paragraph with `inline code`.')
    const source = '```unfinished'
    const props = {
        commentText: source,
        creatorData: { isAssistant: true },
        assistantRun: { kind: 'chat', status: 'running' },
    }
    const { container, rerender } = render(<AnnaMessageBody {...props} />)
    expect(container.firstChild.getAttribute('aria-busy')).toBe('true')
    expect(mockBody.mock.lastCall[0].commentText).toBe(source + '\n```')
    rerender(<AnnaMessageBody {...props} assistantRun={{ kind: 'chat', status: 'completed' }} />)
    expect(container.firstChild.hasAttribute('aria-busy')).toBe(false)
    expect(mockBody.mock.lastCall[0].commentText).toBe(source)
})

it('does not reparse unchanged history for fresh presentation objects, but renders content and activity changes', () => {
    const props = {
        messageId: 'm1',
        commentText: '# History',
        chat: { id: 'c1' },
        creatorData: { isAssistant: true, displayName: 'Anna' },
        containerStyle: { margin: 0 },
    }
    const { rerender } = render(<AnnaMessageBody {...props} />)
    rerender(
        <AnnaMessageBody
            {...props}
            chat={{ id: 'c1' }}
            creatorData={{ ...props.creatorData }}
            containerStyle={{ margin: 0 }}
        />
    )
    expect(mockBody).toHaveBeenCalledTimes(1)
    rerender(<AnnaMessageBody {...props} commentText="# Updated history" />)
    expect(mockBody.mock.lastCall[0].commentText).toBe('# Updated history')
    rerender(<AnnaMessageBody {...props} isLoading assistantRun={{ kind: 'chat', status: 'running' }} />)
    expect(mockBody.mock.lastCall[0].isLoading).toBe(true)
})
