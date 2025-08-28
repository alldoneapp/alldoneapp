import React from 'react'

import SelectedUsersTableThHeaderText from './SelectedUsersTableThHeaderText'

export default function SelectedUsersTableTh({ text1, text2 }) {
    return (
        <th style={{ textAlign: 'center' }}>
            <SelectedUsersTableThHeaderText text1={text1} text2={text2} />
        </th>
    )
}
