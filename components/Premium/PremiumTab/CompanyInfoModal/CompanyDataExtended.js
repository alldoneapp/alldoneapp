import React, { useEffect, useRef } from 'react'

import CompanyName from './CompanyName'
import CompanyAddressFirstLine from './CompanyAddressFirstLine'
import CompanyAddressSecondLine from './CompanyAddressSecondLine'
import CompanyCity from './CompanyCity'
import CompanyCountry from './CompanyCountry'
import CompanyRegister from './CompanyRegister'
import Logo from './Logo'
import CompanyVat from './CompanyVat'
import CompanyCeo from './CompanyCeo'
import CompanyVatId from './CompanyVatId'
import CompanyTaxNumber from './CompanyTaxNumber'
import CompanyBank from './CompanyBank'
import CompanyBankAddress from './CompanyBankAddress'
import CompanyIban from './CompanyIban'
import CompanyBIC from './CompanyBIC'

export default function CompanyDataExtended({ data, setData }) {
    const {
        name,
        addressLine1,
        addressLine2,
        city,
        postalCode,
        country,
        companyRegister,
        vat,
        logo,
        taxNumber,
        vatId,
        ceo,
        bank,
        bankAddress,
        iban,
        bic,
    } = data

    const nameRef = useRef(null)
    const addreesFirstLineRef = useRef(null)
    const addreesSecondLineRef = useRef(null)
    const postalCodeRef = useRef(null)
    const cityRef = useRef(null)
    const countryRef = useRef(null)
    const companyRegisterRef = useRef(null)
    const vatRef = useRef(null)

    const taxNumberRef = useRef(null)
    const vatIdRef = useRef(null)
    const ceoRef = useRef(null)
    const bankRef = useRef(null)
    const bankAddressRef = useRef(null)
    const ibanRef = useRef(null)
    const bicRef = useRef(null)

    const inputsRefs = [
        nameRef,
        addreesFirstLineRef,
        addreesSecondLineRef,
        postalCodeRef,
        cityRef,
        countryRef,
        ceoRef,
        companyRegisterRef,
        vatRef,
        vatIdRef,
        taxNumberRef,
        bankRef,
        bankAddressRef,
        ibanRef,
        bicRef,
    ]

    updateCompanyData = (property, value) => {
        setData(data => {
            return { ...data, [property]: value }
        })
    }

    const updateName = name => {
        updateCompanyData('name', name)
    }

    const updateCeo = ceo => {
        updateCompanyData('ceo', ceo)
    }

    const updateCompanyRegister = companyRegister => {
        updateCompanyData('companyRegister', companyRegister)
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

    const updateVat = vat => {
        updateCompanyData('vat', vat ? Number(vat) : vat)
    }

    const updateVatId = vatId => {
        updateCompanyData('vatId', vatId)
    }

    const updateTaxNumber = taxNumber => {
        updateCompanyData('taxNumber', taxNumber)
    }

    const updateBank = bank => {
        updateCompanyData('bank', bank)
    }

    const updateBankAddress = bankAddress => {
        updateCompanyData('bankAddress', bankAddress)
    }

    const updateIban = iban => {
        updateCompanyData('iban', iban)
    }

    const updateBic = bic => {
        updateCompanyData('bic', bic)
    }

    const updateLogo = logo => {
        updateCompanyData('logo', logo)
        updateCompanyData('logoUpdated', true)
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
            <CompanyCeo ceoRef={ceoRef} ceo={ceo} updateCeo={updateCeo} />
            <CompanyRegister
                companyRegisterRef={companyRegisterRef}
                companyRegister={companyRegister}
                updateCompanyRegister={updateCompanyRegister}
            />

            <CompanyVat vatRef={vatRef} vat={vat} updateVat={updateVat} />
            <CompanyVatId vatIdRef={vatIdRef} vatId={vatId} updateVatId={updateVatId} />
            <CompanyTaxNumber taxNumberRef={taxNumberRef} taxNumber={taxNumber} updateTaxNumber={updateTaxNumber} />
            <CompanyBank bankRef={bankRef} bank={bank} updateBank={updateBank} />
            <CompanyBankAddress
                bankAddressRef={bankAddressRef}
                bankAddress={bankAddress}
                updateBankAddress={updateBankAddress}
            />
            <CompanyIban ibanRef={ibanRef} iban={iban} updateIban={updateIban} />
            <CompanyBIC bicRef={bicRef} bic={bic} updateBic={updateBic} />
            <Logo updateLogo={updateLogo} logo={logo} />
        </>
    )
}
