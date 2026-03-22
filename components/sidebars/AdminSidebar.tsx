"use client"

import { useState } from "react"
import { supabase } from "@/supabase/client"

import "@/styles/sidebar.css"

export default function AdminSidebar({ setPage, features }: any){

  const [showHoliday,setShowHoliday] = useState(false)

  const logout = async ()=>{
    await supabase.auth.signOut()
    window.location.reload()
  }

  const hasFeature = (name:string)=>{
    return features.includes("ALL") || features.includes(name)
  }

  return(

    <div className="dev-sidebar">

      <div className="sidebar-header">

        <div className="sidebar-title">
          Company Admin
        </div>

        <button className="logout-button" onClick={logout}>
          Logout
        </button>

      </div>

      <button
        className="sidebar-button"
        onClick={()=>setPage("dashboard")}
      >
        Dashboard
      </button>

      <button
        className="sidebar-button"
        onClick={()=>setPage("users")}
      >
        Users
      </button>

      {/* 🔥 ONLY SHOW IF FEATURE ENABLED */}

      {hasFeature("Holiday") && (

        <>
          <button
            className="sidebar-button"
            onClick={()=>setShowHoliday(!showHoliday)}
          >
            Holiday
          </button>

          {showHoliday && (

            <div className="sidebar-submenu">

              <button onClick={()=>setPage("holiday-request")}>
                Request Holiday
              </button>

              <button onClick={()=>setPage("holiday-approve")}>
                Approve Requests
              </button>

              <button onClick={()=>setPage("holiday-balance")}>
                Holiday Balance
              </button>

              <button onClick={()=>setPage("holiday-calendar")}>
                Holiday Calendar
              </button>

              <button onClick={()=>setPage("holiday-settings")}>
                Holiday Settings
              </button>

            </div>

          )}

        </>

      )}

    </div>
  )
}