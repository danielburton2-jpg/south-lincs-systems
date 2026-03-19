"use client"

import { useState,useEffect } from "react"
import { supabase } from "@/supabase/client"

import "@/styles/tables.css"

export default function ViewUsers({ company, openEditUser }:any){

const [users,setUsers] = useState<any[]>([])

useEffect(()=>{

loadUsers()

},[company])

const loadUsers = async()=>{

if(!company) return

const { data } = await supabase
.from("company_users")
.select("*")
.eq("company_id",company.company_id)
.order("first_name")

setUsers(data || [])

}

return(

<div className="table-container">

<h1>Company Users</h1>

<table className="users-table">

<thead>

<tr>

<th>Name</th>
<th>Job Title</th>
<th>Role</th>
<th>Status</th>

</tr>

</thead>

<tbody>

{users.map(user=>(

<tr
key={user.id}
className="click-row"
onClick={()=>openEditUser(user)}
>

<td>
{user.first_name} {user.last_name}
</td>

<td>{user.job_title}</td>

<td>{user.role}</td>

<td>{user.status}</td>

</tr>

))}

</tbody>

</table>

</div>

)

}