"use client"

import { useState } from "react"
import { supabase } from "@/supabase/client"
import { auditLog } from "@/lib/audit/auditLogger"

import "@/styles/forms.css"

export default function EditUser({ user, close }: any){

const [firstName,setFirstName] = useState(user.first_name)
const [lastName,setLastName] = useState(user.last_name)
const [jobTitle,setJobTitle] = useState(user.job_title)
const [role,setRole] = useState(user.role)
const [status,setStatus] = useState(user.status)

const save = async()=>{

const { error } = await supabase
.from("company_users")
.update({

first_name:firstName,
last_name:lastName,
job_title:jobTitle,
role:role,
status:status

})
.eq("id",user.id)

if(error){

alert(error.message)
return

}

await auditLog({

action:"edit_user",
table:"company_users",
description:`Edited user ${firstName} ${lastName}`,
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
<input
value={firstName}
onChange={(e)=>setFirstName(e.target.value)}
/>

<label>Last Name</label>
<input
value={lastName}
onChange={(e)=>setLastName(e.target.value)}
/>

<label>Job Title</label>
<input
value={jobTitle}
onChange={(e)=>setJobTitle(e.target.value)}
/>

<label>Role</label>
<select
value={role}
onChange={(e)=>setRole(e.target.value)}
>
<option value="admin">Admin</option>
<option value="manager">Manager</option>
<option value="employee">Employee</option>
</select>

<label>Status</label>
<select
value={status}
onChange={(e)=>setStatus(e.target.value)}
>
<option value="active">Active</option>
<option value="inactive">Inactive</option>
</select>

<div className="form-buttons">

<button
className="secondary-button"
onClick={close}
>
Cancel
</button>

<button
className="primary-button"
onClick={save}
>
Save Changes
</button>

</div>

</div>

</div>

)

}