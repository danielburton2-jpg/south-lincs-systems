"use client"

import { useState,useEffect } from "react"
import { supabase } from "@/supabase/client"
import { auditLog } from "@/lib/audit/auditLogger"

import "@/styles/forms.css"

export default function EditCompanyUser({ user, close }:any){

const [firstName,setFirstName] = useState("")
const [lastName,setLastName] = useState("")
const [email,setEmail] = useState("") // ✅ ADDED
const [role,setRole] = useState("")
const [jobTitle,setJobTitle] = useState("")
const [status,setStatus] = useState("active")

const [password,setPassword] = useState("")

const [jobTitles,setJobTitles] = useState<string[]>([])
const [managerTitles,setManagerTitles] = useState<any>({})

const [loading,setLoading] = useState(false)

/* LOAD USER */

useEffect(()=>{

if(!user) return

setFirstName(user.first_name || "")
setLastName(user.last_name || "")
setEmail(user.email || "") // ✅ ADDED
setRole(user.role || "")
setJobTitle(user.job_title || "")
setStatus(user.status || "active")

loadJobTitles()
loadManagerTitles()

},[user])

/* JOB TITLES */

const loadJobTitles = async()=>{

const { data } = await supabase
.from("company_users")
.select("job_title")
.eq("company_id",user.company_id)
.eq("role","employee")

const unique = [
...new Set(data?.map((u:any)=>u.job_title).filter(Boolean))
]

setJobTitles(unique)

}

/* MANAGER TITLES */

const loadManagerTitles = async()=>{

const { data } = await supabase
.from("manager_job_titles")
.select("job_title")
.eq("manager_id",user.id)

const map:any={}
data?.forEach((t:any)=>{ map[t.job_title]=true })

setManagerTitles(map)

}

const toggleTitle = (title:any)=>{
setManagerTitles((prev:any)=>({
...prev,
[title]:!prev[title]
}))
}

/* SAVE */

const saveUser = async()=>{

setLoading(true)

/* UPDATE USER */

const { error } = await supabase
.from("company_users")
.update({
first_name:firstName,
last_name:lastName,
email, // ✅ ADDED
role,
job_title:jobTitle.trim(),
status
})
.eq("id",user.id)

if(error){
alert(error.message)
setLoading(false)
return
}

/* PASSWORD UPDATE */

if(password){

await fetch("/api/admin/update-password",{
method:"POST",
headers:{ "Content-Type":"application/json" },
body: JSON.stringify({
userId:user.id,
password
})
})

}

/* MANAGER TITLES */

await supabase
.from("manager_job_titles")
.delete()
.eq("manager_id",user.id)

if(role==="manager"){

const rows = Object.keys(managerTitles)
.filter(t=>managerTitles[t])
.map(t=>({
manager_id:user.id,
job_title:t
}))

if(rows.length){
await supabase.from("manager_job_titles").insert(rows)
}

}

/* AUDIT EMAIL */

if(email !== user.email){
await auditLog({
action:"update",
table:"company_users",
fieldName:"email",
oldValue:user.email,
newValue:email,
companyId:user.company_id,
targetId:user.id
})
}

/* GENERAL AUDIT */

await auditLog({
action:"update_user",
table:"company_users",
description:`Updated ${firstName} ${lastName}`,
companyId:user.company_id,
targetId:user.id
})

alert("User Updated")

setLoading(false)
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

{/* ✅ EMAIL FIELD (THIS WAS MISSING) */}

<label>Email</label>
<input
value={email}
onChange={(e)=>setEmail(e.target.value)}
/>

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

{/* PASSWORD */}

<label>New Password</label>
<input
type="password"
placeholder="Leave blank to keep current"
value={password}
onChange={(e)=>setPassword(e.target.value)}
/>

{/* MANAGER TITLES */}

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

<button className="secondary-button" onClick={close}>
Cancel
</button>

<button
className="primary-button"
onClick={saveUser}
disabled={loading}
>
{loading ? "Saving..." : "Save Changes"}
</button>

</div>

</div>

</div>

)

}