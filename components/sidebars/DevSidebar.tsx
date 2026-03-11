"use client"

import { useState } from "react"
import { supabase } from "@/supabase/client"

import "@/styles/sidebar.css"

type DevSidebarProps = {
  setPage: (page: string) => void
}

export default function DevSidebar({ setPage }: DevSidebarProps){

  const [showSuperusers,setShowSuperusers] = useState(false)
  const [showCompanies,setShowCompanies] = useState(false)

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

      {/* DASHBOARD */}

      <button
        className="sidebar-button"
        onClick={()=>setPage("dashboard")}
      >
        Dashboard
      </button>

      {/* SUPERUSERS */}

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

      {/* AUDIT */}

      <button
        className="sidebar-button"
        onClick={()=>setPage("audit")}
      >
        Audit Logs
      </button>

      {/* COMPANIES */}

      <button
        className="sidebar-button"
        onClick={()=>setShowCompanies(!showCompanies)}
      >
        Companies
      </button>

      {showCompanies && (

        <div className="sidebar-submenu">

          <button
            className="sidebar-sub-button"
            onClick={()=>setPage("companies")}
          >
            Create Company
          </button>

          <button
            className="sidebar-sub-button"
            onClick={()=>setPage("view-companies")}
          >
            View Companies
          </button>

        </div>

      )}

    </div>

  )

}