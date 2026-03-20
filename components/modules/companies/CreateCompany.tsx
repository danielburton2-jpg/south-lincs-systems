"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/supabase/client"
import { auditLog } from "@/lib/audit/auditLogger"

import "@/styles/forms.css"

export default function CreateCompany({ close }: any){

  const [name,setName] = useState("")
  const [email,setEmail] = useState("")
  const [phone,setPhone] = useState("")

  const [subscription,setSubscription] =
    useState("free_trial")

  const [subscriptionStart,setSubscriptionStart] =
    useState("")

  const [subscriptionEnd,setSubscriptionEnd] =
    useState("")

  const [override,setOverride] = useState(false)

  const [features,setFeatures] = useState<any[]>([])

  const [loading,setLoading] = useState(false)

  /* LOAD FEATURES */

  useEffect(()=>{

    const loadFeatures = async ()=>{

      const { data, error } = await supabase
        .from("features")
        .select("*")
        .order("name")

      if(error){
        console.error("Feature load error:", error)
        return
      }

      if(data){

        setFeatures(
          data.map((f:any)=>({
            id: f.id,
            name: f.name,
            enabled: false
          }))
        )

      }

    }

    loadFeatures()

  },[])

  /* AUTO SET SUBSCRIPTION DATES */

  useEffect(()=>{

    const today = new Date()

    const start =
      today.toISOString().split("T")[0]

    let end = new Date()

    if(subscription === "free_trial"){
      end.setDate(today.getDate()+30)
    }

    if(subscription === "yearly"){
      end.setFullYear(today.getFullYear()+1)
    }

    const endFormatted =
      end.toISOString().split("T")[0]

    setSubscriptionStart(start)
    setSubscriptionEnd(endFormatted)

  },[subscription])

  /* TOGGLE FEATURE */

  const toggleFeature = (id:string)=>{

    setFeatures((prev:any[]) =>
      prev.map((f:any)=>
        f.id === id
          ? { ...f, enabled: !f.enabled }
          : f
      )
    )

  }

  /* CREATE COMPANY */

  const createCompany = async (e:any)=>{

    e.preventDefault()

    setLoading(true)

    const { data, error } = await supabase
      .from("companies")
      .insert({

        name,
        contact_email:email,
        contact_phone:phone,
        subscription,

        subscription_start:subscriptionStart,
        subscription_end:subscriptionEnd,

        override,
        active:true

      })
      .select()
      .single()

    if(error){

      alert(error.message)
      setLoading(false)
      return

    }

    const companyId = data.id

    /* INSERT FEATURES */

    const selectedFeatures =
      features.filter(f => f.enabled)

    if(selectedFeatures.length){

      const rows = selectedFeatures.map(f => ({
        company_id: companyId,
        feature_id: f.id,
        enabled: true
      }))

      const { error:featureError } = await supabase
        .from("company_features")
        .insert(rows)

      if(featureError){
        console.error("Feature insert error:", featureError)
      }

    }

    await auditLog({

      action:"CREATE",
      table:"companies",
      companyId:data.id,
      targetId:data.id,

      description:`Created company ${name}`

    })

    alert("Company created")

    close()

  }

  return(

    <div className="form-container">

      <h1>Create Company</h1>

      <form
        className="stack-form"
        onSubmit={createCompany}
      >

        <label>Company Name</label>
        <input
          value={name}
          onChange={(e)=>setName(e.target.value)}
          required
        />

        <label>Email</label>
        <input
          value={email}
          onChange={(e)=>setEmail(e.target.value)}
        />

        <label>Phone</label>
        <input
          value={phone}
          onChange={(e)=>setPhone(e.target.value)}
        />

        <label>Subscription</label>
        <select
          value={subscription}
          onChange={(e)=>setSubscription(e.target.value)}
        >
          <option value="free_trial">Free Trial</option>
          <option value="yearly">Yearly</option>
        </select>

        <label>Subscription Start</label>
        <input
          type="date"
          value={subscriptionStart}
          onChange={(e)=>setSubscriptionStart(e.target.value)}
        />

        <label>Subscription End</label>
        <input
          type="date"
          value={subscriptionEnd}
          onChange={(e)=>setSubscriptionEnd(e.target.value)}
        />

        <div className="checkbox-row">
          <input
            type="checkbox"
            checked={override}
            onChange={(e)=>setOverride(e.target.checked)}
          />
          <label>Override subscription expiry</label>
        </div>

        {/* 🔥 FEATURES SECTION */}

        <h3>Features</h3>

        {features.map((feature)=>(

          <div
            key={feature.id}
            className="checkbox-row"
          >

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
            {loading ? "Creating..." : "Create Company"}
          </button>

          <button type="button" onClick={close}>
            Cancel
          </button>

        </div>

      </form>

    </div>

  )

}