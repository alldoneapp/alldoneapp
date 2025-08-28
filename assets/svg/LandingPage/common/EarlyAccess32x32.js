import * as React from 'react'

function SvgComponent(props) {
    return (
        <svg width={33} height={32} viewBox="0 0 33 32" fill="none" {...props}>
            <rect x={0.5} width={32} height={32} rx={6} fill="#D8F4F8" />
            <path
                d="M20.148 18.351a1.2 1.2 0 010 1.698l-3.6 3.6a1.2 1.2 0 01-1.697 0l-2-2a1.2 1.2 0 111.697-1.698l1.152 1.152 2.751-2.752a1.2 1.2 0 011.697 0z"
                fill="#80DEEA"
            />
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M16.5 3.2a7.6 7.6 0 00-7.6 7.6v2.42a4 4 0 00-3.6 3.98v7.6a4 4 0 004 4h14.4a4 4 0 004-4v-7.6a4 4 0 00-4-4H12.1v-2.4a4.4 4.4 0 018.761-.589 1.6 1.6 0 103.172-.422 7.601 7.601 0 00-7.533-6.59zM9.3 16.4a.8.8 0 00-.8.8v7.6a.8.8 0 00.8.8h14.4a.8.8 0 00.8-.8v-7.6a.8.8 0 00-.8-.8H9.3z"
                fill="#80DEEA"
            />
        </svg>
    )
}

export default SvgComponent
