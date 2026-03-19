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

  useEffect(()=>{

    const loadFeatures = async ()=>{

      const { data } = await supabase
        .from("features")
        .select("*")
        .order("name")

      if(data){

        setFeatures(
          data.map((f:any)=>({
            ...f,
            enabled:false
          }))
        )

      }

    }

    loadFeatures()

  },[])

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

  const toggleFeature = (index:number)=>{

    const updated = [...features]

    updated[index].enabled =
      !updated[index].enabled

    setFeatures(updated)

  }

  const createCompany = async (e:any)=>{

    e.preventDefault()

    setLoading(true)

    const { data,error } = await supabase
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

    for(const feature of features){

      if(feature.enabled){

        await supabase
          .from("company_features")
          .insert({

            company_id:companyId,
            feature_key:feature.key,
            enabled:true

          })

      }

    }

    await auditLog({

      action:"CREATE",
      table:"companies",
      companyId:data.id,
      recordId:data.id,

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

          <option value="free_trial">
            Free Trial
          </option>

          <option value="yearly">
            Yearly
          </option>

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
            {loading ? "Creating..." : "Create Company"}
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