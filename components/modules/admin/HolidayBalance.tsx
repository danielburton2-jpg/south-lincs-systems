"use client"

import { useEffect,useState } from "react"
import { supabase } from "@/supabase/client"

import "@/styles/tables.css"

export default function HolidayBalance({ company }: any){

const [users,setUsers] = useState<any[]>([])

useEffect(()=>{

load()

},[company])

const load = async()=>{

if(!company) return

const { data } = await supabase
.from("company_users")
.select("id,first_name,last_name,job_title,holiday_entitlement,holiday_used")
.eq("company_id",company.company_id)

setUsers(data || [])

}

return(

<div className="table-container">

<h1>Holiday Balances</h1>

<table className="users-table">

<thead>

<tr>

<th>Name</th>
<th>Job</th>
<th>Entitlement</th>
<th>Used</th>
<th>Remaining</th>

</tr>

</thead>

<tbody>

{users.map(user=>(

<tr key={user.id}>

<td>
{user.first_name} {user.last_name}
</td>

<td>{user.job_title}</td>

<td>{user.holiday_entitlement || 0}</td>

<td>{user.holiday_used || 0}</td>

<td>
{(user.holiday_entitlement || 0) - (user.holiday_used || 0)}
</td>

</tr>

))}

</tbody>

</table>

</div>

)

}