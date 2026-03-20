"use client"

import { useState,useEffect } from "react"
import { supabase } from "@/supabase/client"

import AdminSidebar from "@/components/sidebars/AdminSidebar"

import ViewUsers from "@/components/modules/admin/ViewUsers"
import EditUser from "@/components/modules/admin/EditUser"

import RequestTime from "@/components/modules/holiday/RequestTime"
import ApproveRequests from "@/components/modules/holiday/ApproveRequests"
import HolidayCalendar from "@/components/modules/holiday/HolidayCalendar"
import HolidayBalance from "@/components/modules/admin/HolidayBalance"
import HolidaySettings from "@/components/modules/holiday/HolidaySettings"

import "@/styles/layout.css"

export default function AdminDashboard(){

const [page,setPage] = useState("dashboard")

const [editUser,setEditUser] = useState<any>(null)

const [company,setCompany] = useState<any>(null)
const [user,setUser] = useState<any>(null)

const [companyFeatures,setCompanyFeatures] = useState<string[]>([])

/* LOAD USER + COMPANY */

useEffect(()=>{
loadUser()
},[])

const loadUser = async()=>{

const { data:userData } =
await supabase.auth.getUser()

const userId = userData?.user?.id

setUser(userData?.user)

/* GET COMPANY */

const { data } = await supabase
.from("company_users")
.select("company_id")
.eq("id",userId)
.single()

setCompany(data)

/* LOAD FEATURES */

if(data?.company_id){
loadFeatures(data.company_id)
}

}

/* 🔥 LOAD FEATURES (FIXED) */

const loadFeatures = async(companyId:string)=>{

const { data:cfData } = await supabase
.from("company_features")
.select("feature_id")
.eq("company_id",companyId)
.eq("enabled",true)

if(!cfData || cfData.length === 0){
setCompanyFeatures([])
return
}

const ids = cfData.map((f:any)=>f.feature_id)

const { data:features } = await supabase
.from("features")
.select("id,name")
.in("id",ids)

const names = features?.map((f:any)=>f.name.toLowerCase()) || []

setCompanyFeatures(names)

}

/* 🔥 HELPER */

const hasFeature = (feature:string)=>{
return companyFeatures.includes(feature.toLowerCase())
}

return(

<div className="dev-layout">

<AdminSidebar setPage={setPage} features={companyFeatures} />

<div className="dev-content">

{/* DASHBOARD */}

{page === "dashboard" && (

<div>
<h1>Company Dashboard</h1>
<p>Manage your company users and system.</p>
</div>

)}

{/* USERS */}

{page === "users" && !editUser && (

<ViewUsers
company={company}
openEditUser={setEditUser}
/>

)}

{page === "users" && editUser && (

<EditUser
user={editUser}
close={()=>setEditUser(null)}
/>

)}

{/* 🔥 HOLIDAY FEATURES LOCKED */}

{hasFeature("holiday") && (

<>

{page === "holiday-request" && (
<RequestTime user={user} close={()=>setPage("dashboard")} />
)}

{page === "holiday-approve" && (
<ApproveRequests company={company} />
)}

{page === "holiday-balance" && (
<HolidayBalance company={company} />
)}

{page === "holiday-calendar" && (
<HolidayCalendar company={company} />
)}

{page === "holiday-settings" && (
<HolidaySettings company={company} />
)}

</>

)}

{/* 🚫 OPTIONAL: BLOCK ACCESS MESSAGE */}

{!hasFeature("holiday") && page.startsWith("holiday") && (

<div>
<h2>Feature Not Enabled</h2>
<p>This company does not have access to the holiday system.</p>
</div>

)}

</div>

</div>

)

}