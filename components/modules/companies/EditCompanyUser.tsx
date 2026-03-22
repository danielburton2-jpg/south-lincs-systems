"use client"

import { useState,useEffect } from "react"
import { supabase } from "@/supabase/client"
import { auditLog } from "@/lib/audit/auditLogger"

import "@/styles/forms.css"

export default function EditCompanyUser({ user, close }: any){

/* BASIC */

const [firstName,setFirstName] = useState("")
const [lastName,setLastName] = useState("")
const [email,setEmail] = useState("")
const [phone,setPhone] = useState("")
const [employeeNumber,setEmployeeNumber] = useState("")
const [role,setRole] = useState("")
const [jobTitle,setJobTitle] = useState("")
const [status,setStatus] = useState("active")
const [password,setPassword] = useState("")

/* HOLIDAY */

const [holidayEnabled,setHolidayEnabled] = useState(false)
const [holidayEntitlement,setHolidayEntitlement] = useState<number | "">("")

/* FEATURES */

const [companyFeatures,setCompanyFeatures] = useState<string[]>([])
const [loading,setLoading] = useState(false)

/* LOAD USER */

useEffect(()=>{

if(!user) return

setFirstName(user.first_name || "")
setLastName(user.last_name || "")
setEmail(user.email || "")
setPhone(user.phone || "")
setEmployeeNumber(user.employee_number || "")
setRole(user.role || "")
setJobTitle(user.job_title || "")
setStatus(user.status || "active")

setHolidayEnabled(user.holiday_enabled || false)
setHolidayEntitlement(user.holiday_entitlement || "")

loadFeatures()

},[user])

/* LOAD COMPANY FEATURES */

const loadFeatures = async()=>{

if(!user?.company_id) return

const { data,error } = await supabase
.from("company_features")
.select("feature_id")
.eq("company_id",user.company_id)
.eq("enabled",true)

if(error){
console.error(error)
return
}

if(!data?.length){
setCompanyFeatures([])
return
}

const ids = data.map((f:any)=>f.feature_id)

const { data:features } = await supabase
.from("features")
.select("id,name")
.in("id",ids)

const names = (features || []).map((f:any)=>f.name.toLowerCase())

setCompanyFeatures(names)

}

/* HELPERS */

const hasHolidayFeature = ()=>{
return companyFeatures.includes("holiday")
}

/* SAVE */

const saveUser = async()=>{

setLoading(true)

/* VALIDATION */

if(hasHolidayFeature() && (role==="admin" || holidayEnabled)){
  if(!holidayEntitlement){
    alert("Please enter holiday entitlement")
    setLoading(false)
    return
  }
}

/* UPDATE USER */

const { error } = await supabase
.from("company_users")
.update({
first_name:firstName,
last_name:lastName,
email,
phone,
employee_number:employeeNumber,
role,
job_title:jobTitle,
status,
holiday_enabled: role==="admin" ? true : holidayEnabled,
holiday_entitlement:
  (role==="admin" || holidayEnabled)
    ? holidayEntitlement
    : null
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

/* AUDIT */

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

/* UI */

return(

<div className="form-container">

<h1>Edit User</h1>

<form className="form">

{/* FIRST NAME */}
<div className="form-group">
<label>First Name</label>
<input value={firstName} onChange={(e)=>setFirstName(e.target.value)} />
</div>

{/* LAST NAME */}
<div className="form-group">
<label>Last Name</label>
<input value={lastName} onChange={(e)=>setLastName(e.target.value)} />
</div>

{/* EMAIL */}
<div className="form-group">
<label>Email</label>
<input value={email} onChange={(e)=>setEmail(e.target.value)} />
</div>

{/* PHONE */}
<div className="form-group">
<label>Phone</label>
<input value={phone} onChange={(e)=>setPhone(e.target.value)} />
</div>

{/* 🔥 ADDED BACK */}

<div className="form-group">
<label>Employee Number</label>
<input value={employeeNumber} onChange={(e)=>setEmployeeNumber(e.target.value)} />
</div>

<div className="form-group">
<label>Job Title</label>
<input value={jobTitle} onChange={(e)=>setJobTitle(e.target.value)} />
</div>

{/* ROLE */}
<div className="form-group">
<label>Role</label>
<select value={role} onChange={(e)=>setRole(e.target.value)}>
<option value="admin">Admin</option>
<option value="manager">Manager</option>
<option value="employee">Employee</option>
</select>
</div>

{/* STATUS */}
<div className="form-group">
<label>Status</label>
<select value={status} onChange={(e)=>setStatus(e.target.value)}>
<option value="active">Active</option>
<option value="inactive">Inactive</option>
</select>
</div>

{/* PASSWORD */}
<div className="form-group">
<label>New Password</label>
<input
type="password"
placeholder="Leave blank to keep current"
value={password}
onChange={(e)=>setPassword(e.target.value)}
/>
</div>

{/* 🔥 HOLIDAY TOGGLE */}

{hasHolidayFeature() && role !== "admin" && (

<div className="form-group">

<div className="checkbox-row">
<input
type="checkbox"
checked={holidayEnabled}
onChange={(e)=>setHolidayEnabled(e.target.checked)}
/>
<label>Enable Holiday Feature</label>
</div>

</div>

)}

{/* 🔥 ENTITLEMENT */}

{hasHolidayFeature() && (role==="admin" || holidayEnabled) && (

<div className="form-group">

<label>Holiday Entitlement (Days)</label>

<input
type="number"
className="entitlement-input"
placeholder="e.g. 25"
value={holidayEntitlement}
onChange={(e)=>setHolidayEntitlement(Number(e.target.value))}
/>

</div>

)}

{/* BUTTONS */}

<div className="form-buttons">

<button type="button" onClick={close}>
Cancel
</button>

<button type="button" onClick={saveUser} disabled={loading}>
{loading ? "Saving..." : "Save Changes"}
</button>

</div>

</form>

</div>

)

}