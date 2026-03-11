"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/supabase/client"
import { auditLog } from "@/lib/audit/auditLogger"

import "@/styles/forms.css"

export default function EditCompany({ company, close }: any){

  const [name,setName] = useState(company.name)

  const [active,setActive] = useState(company.active)

  const [override,setOverride] = useState(company.override)

  const [startDate,setStartDate] =
    useState(company.subscription_start)

  const [endDate,setEndDate] =
    useState(company.subscription_end)

  const [features,setFeatures] = useState<any[]>([])

  const [loading,setLoading] = useState(false)

  /* LOAD FEATURES + COMPANY FEATURES */

  useEffect(()=>{

    const loadFeatures = async ()=>{

      const { data:featureList } = await supabase
        .from("features")
        .select("*")
        .order("name")

      const { data:companyFeatures } = await supabase
        .from("company_features")
        .select("*")
        .eq("company_id",company.id)

      if(featureList){

        const mapped = featureList.map((feature:any)=>{

          const enabled =
            companyFeatures?.find(
              (cf:any)=>cf.feature_key === feature.key
            )

          return{

            ...feature,
            enabled: enabled ? true : false

          }

        })

        setFeatures(mapped)

      }

    }

    loadFeatures()

  },[company.id])

  /* TOGGLE FEATURES */

  const toggleFeature = (index:number)=>{

    const updated = [...features]

    updated[index].enabled =
      !updated[index].enabled

    setFeatures(updated)

  }

  /* SAVE COMPANY */

  const saveCompany = async (e:any)=>{

    e.preventDefault()

    setLoading(true)

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

    /* UPDATE FEATURES */

    for(const feature of features){

      const exists = await supabase
        .from("company_features")
        .select("*")
        .eq("company_id",company.id)
        .eq("feature_key",feature.key)
        .single()

      if(feature.enabled){

        if(!exists.data){

          await supabase
            .from("company_features")
            .insert({

              company_id:company.id,
              feature_key:feature.key,
              enabled:true

            })

        }

      }else{

        await supabase
          .from("company_features")
          .delete()
          .eq("company_id",company.id)
          .eq("feature_key",feature.key)

      }

    }

    await auditLog({

      action:"UPDATE",
      table:"companies",

      companyId:company.id,
      recordId:company.id,

      description:`Updated company ${name}`

    })

    alert("Company updated")

    setLoading(false)

    close()

  }

  return(

    <div className="form-container">

      <h1>Edit Company</h1>

      <form
        className="stack-form"
        onSubmit={saveCompany}
      >

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

          <option value="true">
            Active
          </option>

          <option value="false">
            Inactive
          </option>

        </select>

        <h3>Features</h3>

        {features.map((feature,index)=>(

          <div
            key={feature.id}
            className="checkbox-row"
          >

            <input
              type="checkbox"
              checked={feature.enabled}
              onChange={()=>toggleFeature(index)}
            />

            <label>
              {feature.name}
            </label>

          </div>

        ))}

        <div className="form-buttons">

          <button
            type="submit"
            disabled={loading}
          >
            {loading ? "Saving..." : "Save"}
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