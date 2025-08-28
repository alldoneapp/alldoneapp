import React from 'react'

import DataInput from './DataInput'

export default function CompanyName({ nameRef, name, updateName }) {
    return (
        <DataInput
            autofocus={true}
            inputRef={nameRef}
            headerText={'Name'}
            placeholder={'Type company name'}
            value={name}
            setValue={updateName}
        />
    )
}
