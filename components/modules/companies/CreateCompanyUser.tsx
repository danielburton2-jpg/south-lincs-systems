"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/supabase/client"

type Props = {
  companyId: string
  close: () => void
}

export default function CreateCompanyUser({ companyId, close }: Props){

const [firstName,setFirstName] = useState("")
const [lastName,setLastName] = useState("")
const [email,setEmail] = useState("")
const [phone,setPhone] = useState("")
const [employeeNumber,setEmployeeNumber] = useState("")
const [role,setRole] = useState("")
const [jobTitle,setJobTitle] = useState("")
const [password,setPassword] = useState("")
const [confirmPassword,setConfirmPassword] = useState("")
const [status,setStatus] = useState("active")

const [holidayEnabled,setHolidayEnabled] = useState(false)
const [holidayEntitlement,setHolidayEntitlement] = useState<number | "">("")

const [companyFeatures,setCompanyFeatures] = useState<string[]>([])
const [loading,setLoading] = useState(false)

/* LOAD FEATURES */

useEffect(()=>{

const loadFeatures = async ()=>{

if(!companyId) return

const { data } = await supabase
.from("company_features")
.select("feature_id")
.eq("company_id",companyId)
.eq("enabled",true)

if(!data?.length){
setCompanyFeatures([])
return
}

const ids = data.map((f:any)=>f.feature_id)

const { data:features } = await supabase
.from("features")
.select("id,name")
.in("id",ids)

setCompanyFeatures(
(features || []).map((f:any)=>f.name.toLowerCase())
)

}

loadFeatures()

},[companyId])

const hasHolidayFeature = ()=>{
return companyFeatures.includes("holiday")
}

/* CREATE */

const handleCreateUser = async (e:any)=>{

e.preventDefault()

if(password !== confirmPassword){
alert("Passwords do not match")
return
}

if(hasHolidayFeature() && (role==="admin" || holidayEnabled)){
if(!holidayEntitlement){
alert("Enter holiday entitlement")
return
}
}

setLoading(true)

const res = await fetch("/api/admin/create-user",{
method:"POST",
headers:{ "Content-Type":"application/json" },
body: JSON.stringify({
firstName,
lastName,
email,
phone,
employeeNumber,
role,
jobTitle,
password,
status,
companyId,
holiday_enabled: role==="admin" ? true : holidayEnabled,
holiday_entitlement:
(role==="admin" || holidayEnabled)
? holidayEntitlement
: null
})
})

const data = await res.json()

if(!res.ok){
alert(data.error)
setLoading(false)
return
}

alert("User Created")

setLoading(false)
close()

}

/* UI */

return(

<div className="form-container">

<h1>Create User</h1>

<form className="form" onSubmit={handleCreateUser}>

<div className="form-group">
<label>First Name</label>
<input value={firstName} onChange={(e)=>setFirstName(e.target.value)} required />
</div>

<div className="form-group">
<label>Last Name</label>
<input value={lastName} onChange={(e)=>setLastName(e.target.value)} required />
</div>

<div className="form-group">
<label>Email</label>
<input type="email" value={email} onChange={(e)=>setEmail(e.target.value)} required />
</div>

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

<div className="form-group">
<label>Role</label>
<select value={role} onChange={(e)=>setRole(e.target.value)} required>
<option value="">Select Role</option>
<option value="admin">Admin</option>
<option value="manager">Manager</option>
<option value="employee">Employee</option>
</select>
</div>

{/* HOLIDAY */}

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

{hasHolidayFeature() && (role==="admin" || holidayEnabled) && (
<div className="form-group">
<label>Holiday Entitlement (Days)</label>
<input
type="number"
className="entitlement-input"
value={holidayEntitlement}
onChange={(e)=>setHolidayEntitlement(Number(e.target.value))}
/>
</div>
)}

<div className="form-group">
<label>Password</label>
<input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} required />
</div>

<div className="form-group">
<label>Confirm Password</label>
<input type="password" value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} required />
</div>

<div className="form-group">
<label>Status</label>
<select value={status} onChange={(e)=>setStatus(e.target.value)}>
<option value="active">Active</option>
<option value="inactive">Inactive</option>
</select>
</div>

<div className="form-buttons">

<button type="button" onClick={close}>
Cancel
</button>

<button type="submit" disabled={loading}>
{loading ? "Creating..." : "Create User"}
</button>

</div>

</form>

</div>

)

}