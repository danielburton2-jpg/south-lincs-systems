"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/supabase/client"

import DevSidebar from "@/components/sidebars/DevSidebar"

import AuditSearch from "@/components/modules/audit/AuditSearch"
import AuditResults from "@/components/modules/audit/AuditResults"

import "@/styles/layout.css"

export default function DevDashboard(){

  const [page,setPage] = useState("dashboard")
  const [auditResults,setAuditResults] = useState<any>(null)

  const [userName,setUserName] = useState("")

  useEffect(()=>{

    const loadUser = async ()=>{

      const { data:sessionData } =
        await supabase.auth.getSession()

      const userId = sessionData?.session?.user?.id

      if(!userId) return

      const { data:user } = await supabase
        .from("superusers")
        .select("first_name,last_name")
        .eq("id",userId)
        .single()

      if(user){

        setUserName(
          `${user.first_name} ${user.last_name}`
        )

      }

    }

    loadUser()

  },[])

  return(

    <div className="dev-layout">

      <DevSidebar setPage={setPage}/>

      <div className="dev-content">

        {page === "dashboard" && (

          <div>

            <h1>
              Welcome {userName}
            </h1>

            <p>
              South Lincs Systems Dev Environment
            </p>

          </div>

        )}

        {page === "superusers" && (

          <div>

            <h1>Superusers</h1>

            <p>
              Superuser management coming next.
            </p>

          </div>

        )}

        {page === "audit" && !auditResults && (

          <AuditSearch
            setAuditResults={setAuditResults}
          />

        )}

        {page === "audit" && auditResults && (

          <AuditResults
            results={auditResults}
            setShowResults={()=>setAuditResults(null)}
          />

        )}

      </div>

    </div>

  )

}