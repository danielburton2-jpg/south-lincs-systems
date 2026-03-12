"use client"

import { useState,useEffect } from "react"
import { supabase } from "@/supabase/client"
import { auditLog } from "@/lib/audit/auditLogger"

import "@/styles/tables.css"

export default function ApproveRequests({ company }:any){

const [requests,setRequests] = useState<any[]>([])
const [loading,setLoading] = useState(true)

useEffect(()=>{

loadRequests()

},[])

const loadRequests = async()=>{

setLoading(true)

/* GET CURRENT USER */

const { data:userData } =
await supabase.auth.getUser()

const managerId =
userData?.user?.id

if(!managerId) return

/* GET MANAGER JOB TITLES */

const { data:titles } = await supabase
.from("manager_job_titles")
.select("job_title")
.eq("manager_id",managerId)

const allowedTitles =
titles?.map((t:any)=>t.job_title) || []

/* GET HOLIDAY REQUESTS */

const { data,error } = await supabase
.from("holiday_requests")
.select(`
  *,
  employee:company_users(
    id,
    first_name,
    last_name,
    job_title
  )
`)
.eq("company_id",company.id)
.eq("status","pending")

if(error){

alert(error.message)
return

}

if(!data){

setRequests([])
setLoading(false)
return

}

/* FILTER BY JOB TITLE */

const filtered =
data.filter((r:any)=>
allowedTitles.includes(
r.employee?.job_title
)
)

setRequests(filtered)

setLoading(false)

}

const approveRequest = async(req:any)=>{

const { error } = await supabase
.from("holiday_requests")
.update({
status:"approved"
})
.eq("id",req.id)

if(error){

alert(error.message)
return

}

/* AUDIT */

await auditLog({

action:"approve_holiday",
table:"holiday_requests",
description:`Approved holiday for ${req.employee.first_name} ${req.employee.last_name}`,
companyId:req.company_id,
targetId:req.id

})

loadRequests()

}

const rejectRequest = async(req:any)=>{

const { error } = await supabase
.from("holiday_requests")
.update({
status:"rejected"
})
.eq("id",req.id)

if(error){

alert(error.message)
return

}

await auditLog({

action:"reject_holiday",
table:"holiday_requests",
description:`Rejected holiday for ${req.employee.first_name} ${req.employee.last_name}`,
companyId:req.company_id,
targetId:req.id

})

loadRequests()

}

return(

<div className="table-container">

<h1>Holiday Requests</h1>

{loading && <p>Loading requests...</p>}

{!loading && requests.length === 0 && (
<p>No requests to approve</p>
)}

{requests.length > 0 && (

<table className="users-table">

<thead>

<tr>

<th>Employee</th>
<th>Job Title</th>
<th>Start</th>
<th>End</th>
<th>Actions</th>

</tr>

</thead>

<tbody>

{requests.map(req=>(

<tr key={req.id}>

<td>
{req.employee?.first_name} {req.employee?.last_name}
</td>

<td>
{req.employee?.job_title}
</td>

<td>
{req.start_date}
</td>

<td>
{req.end_date}
</td>

<td>

<button
className="primary-button"
onClick={()=>approveRequest(req)}
>
Approve
</button>

<button
className="secondary-button"
onClick={()=>rejectRequest(req)}
>
Reject
</button>

</td>

</tr>

))}

</tbody>

</table>

)}

</div>

)

}