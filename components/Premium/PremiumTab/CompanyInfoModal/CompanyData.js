import React, { useEffect, useRef } from 'react'

import CompanyName from './CompanyName'
import CompanyAddressFirstLine from './CompanyAddressFirstLine'
import CompanyAddressSecondLine from './CompanyAddressSecondLine'
import CompanyCity from './CompanyCity'
import CompanyCountry from './CompanyCountry'

export default function CompanyData({ data, setData }) {
    const { name, addressLine1, addressLine2, city, postalCode, country } = data

    const nameRef = useRef(null)
    const addreesFirstLineRef = useRef(null)
    const addreesSecondLineRef = useRef(null)
    const postalCodeRef = useRef(null)
    const cityRef = useRef(null)
    const countryRef = useRef(null)

    const inputsRefs = [nameRef, addreesFirstLineRef, addreesSecondLineRef, postalCodeRef, cityRef, countryRef]

    updateCompanyData = (property, value) => {
        setData(data => {
            return { ...data, [property]: value }
        })
    }

    const updateName = name => {
        updateCompanyData('name', name)
    }

    const updateAddressLine1 = addressLine1 => {
        updateCompanyData('addressLine1', addressLine1)
    }

    const updateAddressLine2 = addressLine2 => {
        updateCompanyData('addressLine2', addressLine2)
    }

    const updateCity = city => {
        updateCompanyData('city', city)
    }

    const updatePostalCode = postalCode => {
        updateCompanyData('postalCode', postalCode)
    }

    const updateCountry = country => {
        updateCompanyData('country', country)
    }

    const getAtciveInputIndex = () => {
        for (let i = 0; i < inputsRefs.length; i++) {
            const inputRef = inputsRefs[i]
            if (inputRef.current.isFocused()) return i
        }
    }
    const navigateToNextInput = () => {
        const activeInputIndex = getAtciveInputIndex()
        if (activeInputIndex >= 0) {
            inputsRefs[activeInputIndex].current.blur()
            if (inputsRefs.length === activeInputIndex + 1) {
                inputsRefs[0].current.focus()
            } else {
                inputsRefs[activeInputIndex + 1].current.focus()
            }
        }
    }

    const onKeyDown = event => {
        if (event.key === 'Tab') navigateToNextInput()
    }

    useEffect(() => {
        document.addEventListener('keydown', onKeyDown)
        return () => document.removeEventListener('keydown', onKeyDown)
    })

    return (
        <>
            <CompanyName nameRef={nameRef} name={name} updateName={updateName} />
            <CompanyAddressFirstLine
                addreesFirstLineRef={addreesFirstLineRef}
                addressLine1={addressLine1}
                updateAddressLine1={updateAddressLine1}
            />
            <CompanyAddressSecondLine
                addreesSecondLineRef={addreesSecondLineRef}
                addressLine2={addressLine2}
                updateAddressLine2={updateAddressLine2}
            />
            <CompanyCity
                postalCodeRef={postalCodeRef}
                cityRef={cityRef}
                city={city}
                updateCity={updateCity}
                postalCode={postalCode}
                updatePostalCode={updatePostalCode}
            />
            <CompanyCountry countryRef={countryRef} country={country} updateCountry={updateCountry} />
        </>
    )
}
