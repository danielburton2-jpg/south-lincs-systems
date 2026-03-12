"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/supabase/client"

import DevSidebar from "@/components/sidebars/DevSidebar"

import CreateSuperuser from "@/components/modules/superusers/CreateSuperuser"
import ViewSuperusers from "@/components/modules/superusers/ViewSuperusers"
import EditSuperuser from "@/components/modules/superusers/EditSuperuser"

import CreateCompany from "@/components/modules/companies/CreateCompany"
import ViewCompanies from "@/components/modules/companies/ViewCompanies"

import "@/styles/layout.css"

export default function DevDashboard(){

  const [page,setPage] = useState("dashboard")

  const [userName,setUserName] = useState("")

  const [editUser,setEditUser] = useState<any>(null)

  /* LOAD CURRENT USER */

  useEffect(()=>{

    const loadUser = async ()=>{

      const { data:sessionData } =
        await supabase.auth.getSession()

      const userId =
        sessionData?.session?.user?.id

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

        {/* DASHBOARD */}

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

        {/* CREATE SUPERUSER */}

        {page === "create-superuser" && (

          <CreateSuperuser
            close={()=>setPage("dashboard")}
          />

        )}

        {/* VIEW SUPERUSERS */}

        {page === "view-superusers" && !editUser && (

          <ViewSuperusers
            openEdit={setEditUser}
          />

        )}

        {/* EDIT SUPERUSER */}

        {page === "view-superusers" && editUser && (

          <EditSuperuser
            user={editUser}
            close={()=>setEditUser(null)}
          />

        )}

        {/* CREATE COMPANY */}

        {page === "create-company" && (

          <CreateCompany
            close={()=>setPage("view-companies")}
          />

        )}

        {/* VIEW COMPANIES */}

        {page === "view-companies" && (

          <ViewCompanies/>

        )}

      </div>

    </div>

  )

}