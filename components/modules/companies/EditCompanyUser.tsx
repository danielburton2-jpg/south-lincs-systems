"use client"

import { useState,useEffect } from "react"
import { supabase } from "@/supabase/client"
import { auditLog } from "@/lib/audit/auditLogger"

import "@/styles/forms.css"

export default function EditCompanyUser({ user, close }:any){

const [firstName,setFirstName] = useState("")
const [lastName,setLastName] = useState("")
const [role,setRole] = useState("")
const [jobTitle,setJobTitle] = useState("")
const [status,setStatus] = useState("active")

const [jobTitles,setJobTitles] = useState<string[]>([])
const [managerTitles,setManagerTitles] = useState<any>({})

useEffect(()=>{

loadUser()
loadJobTitles()
loadManagerTitles()

},[])

const loadUser = ()=>{

setFirstName(user.first_name)
setLastName(user.last_name)
setRole(user.role)
setJobTitle(user.job_title)
setStatus(user.status)

}

const loadJobTitles = async()=>{

const { data,error } = await supabase
.from("company_users")
.select("job_title")
.eq("company_id",user.company_id)
.eq("role","employee")

if(error) return

const unique = [
...new Set(
data
?.map((u:any)=>u.job_title)
.filter(Boolean)
)
]

setJobTitles(unique)

}

const loadManagerTitles = async()=>{

const { data,error } = await supabase
.from("manager_job_titles")
.select("job_title")
.eq("manager_id",user.id)

if(error) return

const map:any={}

data?.forEach((t:any)=>{

map[t.job_title]=true

})

setManagerTitles(map)

}

const toggleTitle = (title:any)=>{

setManagerTitles((prev:any)=>({

...prev,
[title]:!prev[title]

}))

}

const saveUser = async()=>{

const { error } = await supabase
.from("company_users")
.update({

first_name:firstName,
last_name:lastName,
role:role,
job_title:jobTitle.trim(),
status:status

})
.eq("id",user.id)

if(error){

alert(error.message)
return

}

await supabase
.from("manager_job_titles")
.delete()
.eq("manager_id",user.id)

if(role==="manager"){

const rows = Object.keys(managerTitles)
.filter(title=>managerTitles[title])
.map(title=>({

manager_id:user.id,
job_title:title

}))

if(rows.length){

await supabase
.from("manager_job_titles")
.insert(rows)

}

}

await auditLog({

action:"update_user",
table:"company_users",
description:`Updated user ${firstName} ${lastName}`,
companyId:user.company_id,
targetId:user.id

})

close()

}

return(

<div className="form-container">

<h1>Edit User</h1>

<div className="stack-form">

<label>First Name</label>
<input value={firstName} onChange={(e)=>setFirstName(e.target.value)} />

<label>Last Name</label>
<input value={lastName} onChange={(e)=>setLastName(e.target.value)} />

<label>Role</label>
<select value={role} onChange={(e)=>setRole(e.target.value)}>

<option value="admin">Admin</option>
<option value="manager">Manager</option>
<option value="employee">Employee</option>

</select>

<label>Job Title</label>
<input value={jobTitle} onChange={(e)=>setJobTitle(e.target.value)} />

<label>Status</label>
<select value={status} onChange={(e)=>setStatus(e.target.value)}>

<option value="active">Active</option>
<option value="inactive">Inactive</option>

</select>

{role==="manager" && (

<div className="feature-section">

<h3>Manage Job Titles</h3>

{jobTitles.map(title=>(

<label key={title} className="feature-row">

<input
type="checkbox"
checked={managerTitles[title] || false}
onChange={()=>toggleTitle(title)}
/>

{title}

</label>

))}

</div>

)}

<div className="form-buttons">

<button
className="secondary-button"
onClick={close}
>
Cancel
</button>

<button
className="primary-button"
onClick={saveUser}
>
Save Changes
</button>

</div>

</div>

</div>

)

}