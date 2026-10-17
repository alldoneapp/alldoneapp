import React from 'react'

// A plain text stand-in for the rich parser and contact SocialText. Give it the
// same bounded two-line area; account lookup and rich tags are outside this test.
export default function TextLeaf({ text, children }) {
    return (
        <div
            style={{
                flex: 1,
                minWidth: 0,
                minHeight: 24,
                maxHeight: 48,
                overflow: 'hidden',
                margin: '0 8px',
                fontSize: 16,
                lineHeight: '24px',
                color: 'white',
            }}
        >
            {text || children}
        </div>
    )
}
