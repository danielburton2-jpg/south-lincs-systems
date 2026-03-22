"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/supabase/client"

import AdminSidebar from "@/components/sidebars/AdminSidebar"

import RequestTime from "@/components/modules/holiday/RequestTime"
import ApproveRequests from "@/components/modules/holiday/ApproveRequests"
import HolidayCalendar from "@/components/modules/holiday/HolidayCalendar"
import HolidayBalance from "@/components/modules/holiday/HolidayBalance"
import HolidaySettings from "@/components/modules/holiday/HolidaySettings"

import "@/styles/layout.css"

export default function AdminDashboard(){

  const [page,setPage] = useState("dashboard")
  const [editUser,setEditUser] = useState<any>(null)

  const [user,setUser] = useState<any>(null)
  const [features,setFeatures] = useState<string[]>([])

  useEffect(()=>{
    loadUserAndFeatures()
  },[])

  /* =========================
     LOAD USER + FEATURES
  ========================= */

  const loadUserAndFeatures = async ()=>{

    const { data:userData } = await supabase.auth.getUser()
    const authUser = userData?.user

    if(!authUser) return

    setUser(authUser)

    /* 🔥 FIXED: USE auth_user_id NOT id */

    const { data:userRow } = await supabase
      .from("company_users")
      .select("company_id, role")
      .eq("auth_user_id", authUser.id)   // ✅ FIX
      .single()

    if(!userRow) return

    console.log("Role:", userRow.role)

    /* 🔥 ADMIN = FULL ACCESS */

    if(userRow.role === "admin"){
      setFeatures(["ALL"])
      console.log("Admin → ALL features enabled")
      return
    }

    /* 🔥 LOAD COMPANY FEATURES */

    const { data:cf, error } = await supabase
      .from("company_features")
      .select(`
        feature_id,
        features:feature_id (
          id,
          name
        )
      `)
      .eq("company_id", userRow.company_id)
      .eq("enabled", true)

    if(error){
      console.error("Feature load error:", error)
      return
    }

    const names = cf
      ?.map((f:any)=>f.features?.name)
      .filter(Boolean) || []

    console.log("Company Features:", names)

    setFeatures(names)
  }

  /* =========================
     FEATURE CHECK
  ========================= */

  const hasFeature = (name:string)=>{
    return features.includes("ALL") || features.includes(name)
  }

  return(

    <div className="dev-layout">

      <AdminSidebar
        setPage={setPage}
        features={features}
      />

      <div className="dev-content">

        {/* DASHBOARD */}

        {page === "dashboard" && (
          <div>
            <h1>Company Dashboard</h1>
            <p>Manage your company users and system.</p>
          </div>
        )}

        {/* 🔥 HOLIDAY FEATURES */}

        {hasFeature("Holiday") && page === "holiday-request" && (
          <RequestTime
            user={user}
            close={()=>setPage("dashboard")}
          />
        )}

        {hasFeature("Holiday") && page === "holiday-approve" && (
          <ApproveRequests />
        )}

        {hasFeature("Holiday") && page === "holiday-balance" && (
          <HolidayBalance />
        )}

        {hasFeature("Holiday") && page === "holiday-calendar" && (
          <HolidayCalendar />
        )}

        {hasFeature("Holiday") && page === "holiday-settings" && (
          <HolidaySettings />
        )}

      </div>

    </div>
  )
}