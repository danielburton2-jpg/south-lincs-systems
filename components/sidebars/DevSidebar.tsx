"use client"

import { useState } from "react"
import { supabase } from "@/supabase/client"

import "@/styles/sidebar.css"

export default function DevSidebar({ setPage }: any){

  const [showSuperusers,setShowSuperusers] = useState(false)

  const logout = async ()=>{

    await supabase.auth.signOut()

    window.location.reload()

  }

  return(

    <div className="dev-sidebar">

      <div className="sidebar-header">

        <div className="sidebar-title">
          Dev Panel
        </div>

        <button
          className="logout-button"
          onClick={logout}
        >
          Logout
        </button>

      </div>

      <button
        className="sidebar-button"
        onClick={()=>setPage("dashboard")}
      >
        Dashboard
      </button>

      {/* SUPERUSERS DROPDOWN */}

      <button
        className="sidebar-button"
        onClick={()=>setShowSuperusers(!showSuperusers)}
      >
        Superusers
      </button>

      {showSuperusers && (

        <div className="sidebar-submenu">

          <button
            className="sidebar-sub-button"
            onClick={()=>setPage("create-superuser")}
          >
            Create Superuser
          </button>

          <button
            className="sidebar-sub-button"
            onClick={()=>setPage("view-superusers")}
          >
            View Superusers
          </button>

        </div>

      )}

      <button
        className="sidebar-button"
        onClick={()=>setPage("audit")}
      >
        Audit Logs
      </button>

    </div>

  )

}