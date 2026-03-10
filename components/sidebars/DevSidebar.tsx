"use client"

import { supabase } from "@/supabase/client"

import "@/styles/sidebar.css"

export default function DevSidebar({ setPage }: any) {

  const logout = async () => {

    await supabase.auth.signOut()

    window.location.reload()

  }

  return (

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

      <button
        className="sidebar-button"
        onClick={()=>setPage("superusers")}
      >
        Superusers
      </button>

      <button
        className="sidebar-button"
        onClick={()=>setPage("audit")}
      >
        Audit Logs
      </button>

    </div>

  )

}