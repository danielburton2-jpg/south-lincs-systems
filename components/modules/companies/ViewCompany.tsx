"use client"

import { useEffect } from "react"
import { auditLog } from "@/lib/audit/auditLogger"

import "@/styles/forms.css"

export default function ViewCompany({
  company,
  close,
  openEdit
}: any){

  if(!company) return null

  useEffect(()=>{

    auditLog({

      action:"VIEW",
      table:"companies",

      companyId:company.id,
      recordId:company.id,

      description:`Viewed company ${company.name}`

    })

  },[company])

  return(

    <div className="form-container">

      <h1>{company.name}</h1>

      <form className="stack-form">

        <label>Company Name</label>
        <input value={company.name} readOnly />

        <label>Subscription Start</label>
        <input value={company.subscription_start || ""} readOnly />

        <label>Subscription End</label>
        <input value={company.subscription_end || ""} readOnly />

        <label>Active</label>
        <input value={company.active ? "Yes" : "No"} readOnly />

        <label>Override</label>
        <input value={company.override ? "Yes" : "No"} readOnly />

        <div className="stack-button-group">

          <button
            type="button"
            onClick={()=>openEdit(company)}
          >
            Edit
          </button>

          <button type="button">
            Create Users
          </button>

          <button type="button">
            View Company Users
          </button>

          <button
            type="button"
            onClick={close}
          >
            Cancel
          </button>

        </div>

      </form>

    </div>

  )

}