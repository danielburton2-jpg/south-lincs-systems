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

  const [companyFeatures,setCompanyFeatures] = useState<string[]>([])
  const [loading,setLoading] = useState(false)

  /* 🔥 LOAD COMPANY FEATURES (FIXED VERSION) */

  useEffect(()=>{

    const loadFeatures = async ()=>{

      if(!companyId) return

      /* STEP 1: GET COMPANY FEATURE IDS */

      const { data:companyFeaturesData, error } = await supabase
        .from("company_features")
        .select("feature_id")
        .eq("company_id",companyId)
        .eq("enabled",true)

      if(error){
        console.error("Feature load error:", error)
        return
      }

      if(!companyFeaturesData?.length){
        setCompanyFeatures([])
        return
      }

      /* STEP 2: GET FEATURE NAMES */

      const ids = companyFeaturesData.map((f:any)=>f.feature_id)

      const { data:features, error:featureError } = await supabase
        .from("features")
        .select("id,name")
        .in("id",ids)

      if(featureError){
        console.error("Feature names error:", featureError)
        return
      }

      const names = features.map((f:any)=>f.name.toLowerCase())

      setCompanyFeatures(names)

      console.log("Company Features:", names)

    }

    loadFeatures()

  },[companyId])

  /* 🔥 HELPER */

  const hasFeature = (feature:string)=>{
    return companyFeatures.includes(feature.toLowerCase())
  }

  /* CREATE USER */

  const handleCreateUser = async (e:any)=>{

    e.preventDefault()

    if(!companyId){
      alert("Company ID missing")
      return
    }

    if(password !== confirmPassword){
      alert("Passwords do not match")
      return
    }

    setLoading(true)

    const res = await fetch("/api/admin/create-user",{
      method:"POST",
      headers:{
        "Content-Type":"application/json"
      },
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
        companyId
      })
    })

    const data = await res.json()

    if(!res.ok){
      alert(data.error)
      setLoading(false)
      return
    }

    alert("User Created")

    // RESET
    setFirstName("")
    setLastName("")
    setEmail("")
    setPhone("")
    setEmployeeNumber("")
    setRole("")
    setJobTitle("")
    setPassword("")
    setConfirmPassword("")
    setStatus("active")

    setLoading(false)
    close()

  }

  return(

    <div className="page-container">

      <h1 className="page-title">
        Create User
      </h1>

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

        <div className="form-group">
          <label>Employee Number</label>
          <input value={employeeNumber} onChange={(e)=>setEmployeeNumber(e.target.value)} />
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

        <div className="form-group">
          <label>Job Title</label>
          <input value={jobTitle} onChange={(e)=>setJobTitle(e.target.value)} />
        </div>

        {/* 🔥 FEATURE VISIBILITY PREVIEW */}

        {role && role !== "admin" && (

          <div className="feature-section">

            <h3>Enabled Features (Company Controlled)</h3>

            {companyFeatures.length === 0 && (
              <p>No features enabled for this company</p>
            )}

            {companyFeatures.map((feature)=>(
              <div key={feature} className="feature-row">
                ✓ {feature}
              </div>
            ))}

            {/* 🔥 EXAMPLE: HOLIDAY FEATURE */}

            {hasFeature("holiday") && (
              <div className="feature-highlight">
                Holiday requests ENABLED for this company
              </div>
            )}

            {!hasFeature("holiday") && (
              <div className="feature-disabled">
                Holiday feature NOT enabled
              </div>
            )}

          </div>

        )}

        {/* SECURITY */}

        <h2 className="section-title">Security</h2>

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

          <button type="button" className="cancel-btn" onClick={close}>
            Cancel
          </button>

          <button type="submit" className="create-btn" disabled={loading}>
            {loading ? "Creating..." : "Create User"}
          </button>

        </div>

      </form>

    </div>

  )

}