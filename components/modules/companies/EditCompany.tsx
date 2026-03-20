"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/supabase/client"
import { auditLog } from "@/lib/audit/auditLogger"

import "@/styles/forms.css"

export default function EditCompany({ company, close }: any){

  const [name,setName] = useState(company.name)
  const [active,setActive] = useState(company.active)
  const [override,setOverride] = useState(company.override)

  const [startDate,setStartDate] = useState(company.subscription_start)
  const [endDate,setEndDate] = useState(company.subscription_end)

  const [features,setFeatures] = useState<any[]>([])
  const [loading,setLoading] = useState(false)

  /* 🔥 LOAD FEATURES */

  useEffect(()=>{

    const loadFeatures = async ()=>{

      /* ALL FEATURES */
      const { data:featureList, error:fError } = await supabase
        .from("features")
        .select("id,name")
        .order("name")

      if(fError){
        console.error("Feature list error:", fError)
        return
      }

      /* COMPANY FEATURES */
      const { data:companyFeatures, error:cError } = await supabase
        .from("company_features")
        .select("feature_id")
        .eq("company_id",company.id)

      if(cError){
        console.warn("Company feature warning:", cError)
      }

      /* 🔥 SAFE DEFAULT */
      const safeCompanyFeatures = companyFeatures || []

      /* MAP FEATURES */
      const mapped = featureList.map((feature:any)=>{

        const enabled =
          safeCompanyFeatures.some(
            (cf:any)=>cf.feature_id === feature.id
          )

        return{
          id: feature.id,
          name: feature.name,
          enabled
        }

      })

      setFeatures(mapped)

    }

    loadFeatures()

  },[company.id])

  /* 🔁 TOGGLE FEATURE */

  const toggleFeature = (id:string)=>{

    setFeatures(prev =>
      prev.map(f =>
        f.id === id
          ? { ...f, enabled: !f.enabled }
          : f
      )
    )

  }

  /* 💾 SAVE COMPANY */

  const saveCompany = async (e:any)=>{

    e.preventDefault()
    setLoading(true)

    /* UPDATE COMPANY */

    const { error } = await supabase
      .from("companies")
      .update({
        name,
        active,
        override,
        subscription_start:startDate,
        subscription_end:endDate
      })
      .eq("id",company.id)

    if(error){
      alert(error.message)
      setLoading(false)
      return
    }

    /* 🔥 DELETE OLD FEATURES */

    const { error:deleteError } = await supabase
      .from("company_features")
      .delete()
      .eq("company_id",company.id)

    if(deleteError){
      console.error("Feature delete error:", deleteError)
    }

    /* 🔥 INSERT SELECTED FEATURES */

    const selected = features.filter(f => f.enabled)

    if(selected.length){

      const rows = selected.map(f => ({
        company_id: company.id,
        feature_id: f.id,
        enabled: true
      }))

      const { error:insertError } = await supabase
        .from("company_features")
        .insert(rows)

      if(insertError){
        console.error("Feature insert error:", insertError)
      }

    }

    /* 🔍 AUDIT */

    await auditLog({
      action:"UPDATE",
      table:"companies",
      companyId:company.id,
      targetId:company.id,
      description:`Updated company ${name}`
    })

    alert("Company updated")

    setLoading(false)
    close()

  }

  return(

    <div className="form-container">

      <h1>Edit Company</h1>

      <form className="stack-form" onSubmit={saveCompany}>

        <label>Company Name</label>
        <input
          value={name}
          onChange={(e)=>setName(e.target.value)}
        />

        <label>Subscription Start</label>
        <input
          type="date"
          value={startDate || ""}
          onChange={(e)=>setStartDate(e.target.value)}
        />

        <label>Subscription End</label>
        <input
          type="date"
          value={endDate || ""}
          onChange={(e)=>setEndDate(e.target.value)}
        />

        <div className="checkbox-row">
          <input
            type="checkbox"
            checked={override}
            onChange={(e)=>setOverride(e.target.checked)}
          />
          <label>Override subscription expiry</label>
        </div>

        <label>Active</label>
        <select
          value={active ? "true" : "false"}
          onChange={(e)=>setActive(e.target.value === "true")}
        >
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>

        {/* 🔥 FEATURES */}

        <h3>Features</h3>

        {features.length === 0 && (
          <p>No features found</p>
        )}

        {features.map(feature=>(
          <div key={feature.id} className="checkbox-row">
            <input
              type="checkbox"
              checked={feature.enabled}
              onChange={()=>toggleFeature(feature.id)}
            />
            <label>{feature.name}</label>
          </div>
        ))}

        <div className="form-buttons">

          <button type="submit" disabled={loading}>
            {loading ? "Saving..." : "Save"}
          </button>

          <button type="button" onClick={close}>
            Cancel
          </button>

        </div>

      </form>

    </div>

  )

}