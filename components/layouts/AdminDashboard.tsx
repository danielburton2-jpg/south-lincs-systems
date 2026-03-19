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

useEffect(()=>{

loadUser()

},[])

const loadUser = async()=>{

const { data:userData } =
await supabase.auth.getUser()

const userId =
userData?.user?.id

setUser(userData?.user)

const { data } = await supabase
.from("company_users")
.select("company_id")
.eq("id",userId)
.single()

setCompany(data)

}

return(

<div className="dev-layout">

<AdminSidebar setPage={setPage}/>

<div className="dev-content">

{/* DASHBOARD */}

{page === "dashboard" && (

<div>

<h1>Company Dashboard</h1>

<p>Manage your company users and holidays.</p>

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

{/* HOLIDAY REQUEST */}

{page === "holiday-request" && (

<RequestTime
user={user}
close={()=>setPage("dashboard")}
/>

)}

{/* APPROVE REQUESTS */}

{page === "holiday-approve" && (

<ApproveRequests
company={company}
/>

)}

{/* HOLIDAY BALANCE */}

{page === "holiday-balance" && (

<HolidayBalance
company={company}
/>

)}

{/* HOLIDAY CALENDAR */}

{page === "holiday-calendar" && (

<HolidayCalendar
company={company}
/>

)}

{/* HOLIDAY SETTINGS */}

{page === "holiday-settings" && (

<HolidaySettings
company={company}
/>

)}

</div>

</div>

)

}