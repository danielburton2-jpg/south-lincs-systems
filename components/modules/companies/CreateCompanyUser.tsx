"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/supabase/client"
import { auditLog } from "@/lib/audit/auditLogger"

import "@/styles/forms.css"

export default function CreateCompanyUser({ company, close }: any){

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

  const [features,setFeatures] = useState<any[]>([])
  const [selectedFeatures,setSelectedFeatures] = useState<any>({})

  useEffect(()=>{

    const loadFeatures = async ()=>{

      const { data } = await supabase
        .from("features")
        .select("*")
        .order("name")

      if(data){
        setFeatures(data)
      }

    }

    loadFeatures()

  },[])

  const toggleFeature = (key:any)=>{

    setSelectedFeatures((prev:any)=>({

      ...prev,
      [key]: !prev[key]

    }))

  }

  const createUser = async ()=>{

    if(password !== confirmPassword){

      alert("Passwords do not match")
      return

    }

    const { data,error } = await supabase
      .from("company_users")
      .insert({

        company_id: company.id,

        first_name:firstName,
        last_name:lastName,

        email:email,
        phone:phone,

        employee_number:employeeNumber,

        role:role,
        job_title:jobTitle,

        password:password,

        status:status

      })
      .select()
      .single()

    if(error){

      alert(error.message)
      return

    }

    const userId = data.id

    if(role === "manager" || role === "employee"){

      const featureRows = Object.keys(selectedFeatures)
        .filter(key => selectedFeatures[key])
        .map(key => ({

          user_id:userId,
          feature_key:key

        }))

      if(featureRows.length){

        await supabase
          .from("user_features")
          .insert(featureRows)

      }

    }

    await auditLog({

      action:"create_user",
      table:"company_users",
      description:`Created user ${firstName} ${lastName}`,
      companyId:company.id,
      targetId:userId

    })

    close()

  }

  return(

    <div className="form-container">

      <h1>Create User</h1>

      <div className="stack-form">

        <label>First Name</label>
        <input value={firstName} onChange={(e)=>setFirstName(e.target.value)} autoComplete="off"/>

        <label>Last Name</label>
        <input value={lastName} onChange={(e)=>setLastName(e.target.value)} autoComplete="off"/>

        <label>Email</label>
        <input value={email} onChange={(e)=>setEmail(e.target.value)} autoComplete="off"/>

        <label>Phone</label>
        <input value={phone} onChange={(e)=>setPhone(e.target.value)} autoComplete="off"/>

        <label>Employee Number</label>
        <input value={employeeNumber} onChange={(e)=>setEmployeeNumber(e.target.value)} autoComplete="off"/>

        <label>Role</label>
        <select value={role} onChange={(e)=>setRole(e.target.value)}>

          <option value="">Select Role</option>
          <option value="admin">Admin</option>
          <option value="manager">Manager</option>
          <option value="employee">Employee</option>

        </select>

        <label>Job Title</label>
        <input value={jobTitle} onChange={(e)=>setJobTitle(e.target.value)} autoComplete="off"/>

        <h3>Security</h3>

        <label>Password</label>
        <input type="password" value={password} onChange={(e)=>setPassword(e.target.value)} autoComplete="new-password"/>

        <label>Confirm Password</label>
        <input type="password" value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} autoComplete="new-password"/>

        <label>Status</label>
        <select value={status} onChange={(e)=>setStatus(e.target.value)}>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>

        {(role === "manager" || role === "employee") && (

          <div className="feature-section">

            <h3>User Features</h3>

            {features.map((feature:any)=>(

              <label key={feature.key} className="feature-row">

                <input
                  type="checkbox"
                  checked={selectedFeatures[feature.key] || false}
                  onChange={()=>toggleFeature(feature.key)}
                />

                {feature.name}

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
            onClick={createUser}
          >
            Create User
          </button>

        </div>

      </div>

    </div>

  )

}