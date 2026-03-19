"use client"

import { useEffect,useState } from "react"
import { supabase } from "@/supabase/client"

import "@/styles/tables.css"

export default function HolidayRequests({ company }:any){

const [requests,setRequests] = useState<any[]>([])

useEffect(()=>{

load()

},[company])

const load = async()=>{

if(!company) return

const { data } = await supabase
.from("holiday_requests")
.select(`
*,
employee:company_users(first_name,last_name,job_title)
`)
.eq("company_id",company.company_id)
.order("start_date")

setRequests(data || [])

}

return(

<div className="table-container">

<h1>Holiday Requests</h1>

<table className="users-table">

<thead>

<tr>

<th>Employee</th>
<th>Job</th>
<th>Start</th>
<th>End</th>
<th>Status</th>

</tr>

</thead>

<tbody>

{requests.map(r=>(

<tr key={r.id}>

<td>
{r.employee.first_name} {r.employee.last_name}
</td>

<td>{r.employee.job_title}</td>

<td>{r.start_date}</td>

<td>{r.end_date}</td>

<td>{r.status}</td>

</tr>

))}

</tbody>

</table>

</div>

)

}