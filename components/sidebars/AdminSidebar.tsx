"use client"

import { useState } from "react"
import { supabase } from "@/supabase/client"

import "@/styles/sidebar.css"

export default function AdminSidebar({ setPage, features }: any){

const [showHoliday,setShowHoliday] = useState(false)

/* 🔥 FEATURE CHECK */

const hasFeature = (feature:string)=>{
return features?.includes(feature.toLowerCase())
}

const logout = async ()=>{

await supabase.auth.signOut()

window.location.reload()

}

return(

<div className="dev-sidebar">

<div className="sidebar-header">

<div className="sidebar-title">
Company Admin
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
onClick={()=>setPage("users")}
>
Users
</button>

{/* 🔥 HOLIDAY DROPDOWN (LOCKED) */}

{hasFeature("holiday") && (

<>

<button
className="sidebar-button"
onClick={()=>setShowHoliday(!showHoliday)}
>
Holiday
</button>

{showHoliday && (

<div className="sidebar-submenu">

<button
className="sidebar-sub-button"
onClick={()=>setPage("holiday-request")}
>
Request Holiday
</button>

<button
className="sidebar-sub-button"
onClick={()=>setPage("holiday-approve")}
>
Approve Requests
</button>

<button
className="sidebar-sub-button"
onClick={()=>setPage("holiday-balance")}
>
Holiday Balance
</button>

<button
className="sidebar-sub-button"
onClick={()=>setPage("holiday-calendar")}
>
Holiday Calendar
</button>

<button
className="sidebar-sub-button"
onClick={()=>setPage("holiday-settings")}
>
Holiday Settings
</button>

</div>

)}

</>

)}

</div>

)

}