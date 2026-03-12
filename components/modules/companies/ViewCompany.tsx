"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/supabase/client"

import "@/styles/company.css"

export default function ViewCompany({
  company,
  close,
  openEdit,
  openCreateUser
}: any){

  const [activeUsers,setActiveUsers] = useState(0)
  const [inactiveUsers,setInactiveUsers] = useState(0)

  useEffect(()=>{

    const loadStats = async ()=>{

      const { data } = await supabase
        .from("company_users")
        .select("status")
        .eq("company_id",company.id)

      if(!data) return

      const active =
        data.filter((u:any)=>u.status === "active").length

      const inactive =
        data.filter((u:any)=>u.status !== "active").length

      setActiveUsers(active)
      setInactiveUsers(inactive)

    }

    loadStats()

  },[company.id])

  return(

    <div className="company-wrapper">

      <h1 className="company-title">
        {company.name}
      </h1>

      {/* TOP SECTION */}

      <div className="company-top">

        {/* USER STATS */}

        <div className="company-stats">

          <h3>User Statistics</h3>

          <div className="stat-row">
            <span>{activeUsers}</span>
            Active Users
          </div>

          <div className="stat-row">
            <span>{inactiveUsers}</span>
            Inactive Users
          </div>

          <div className="stat-row">
            <span>{activeUsers + inactiveUsers}</span>
            Total Users
          </div>

        </div>

        {/* COMPANY INFO */}

        <div className="company-info">

          <label>Subscription Start</label>
          <input value={company.subscription_start} disabled />

          <label>Subscription End</label>
          <input value={company.subscription_end} disabled />

          <label>Active</label>
          <input value={company.active ? "Yes" : "No"} disabled />

          <label>Override</label>
          <input value={company.override ? "Yes" : "No"} disabled />

        </div>

      </div>

      {/* ACTION BUTTONS */}

      <div className="company-actions">

        <button
          className="primary-button"
          onClick={()=>openEdit(company)}
        >
          Edit
        </button>

        <button
          className="primary-button"
          onClick={()=>openCreateUser(company)}
        >
          Create Users
        </button>

        <button className="primary-button">
          View Company Users
        </button>

        <button
          className="secondary-button"
          onClick={close}
        >
          Cancel
        </button>

      </div>

    </div>

  )

}