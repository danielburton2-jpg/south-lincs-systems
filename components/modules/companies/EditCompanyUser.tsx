"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/supabase/client"
import { auditLog } from "@/lib/audit/auditLogger"

import "@/styles/forms.css"

export default function EditCompanyUser({ user, close }: any){

  const [firstName,setFirstName] = useState("")
  const [lastName,setLastName] = useState("")
  const [email,setEmail] = useState("")
  const [phone,setPhone] = useState("")
  const [employeeNumber,setEmployeeNumber] = useState("")
  const [role,setRole] = useState("")
  const [jobTitle,setJobTitle] = useState("")
  const [status,setStatus] = useState("active")

  const [features,setFeatures] = useState<any[]>([])
  const [selectedFeatures,setSelectedFeatures] = useState<any>({})

  useEffect(()=>{

    loadUser()
    loadFeatures()

  },[])

  const loadUser = ()=>{

    setFirstName(user.first_name)
    setLastName(user.last_name)
    setEmail(user.email)
    setPhone(user.phone)
    setEmployeeNumber(user.employee_number)
    setRole(user.role)
    setJobTitle(user.job_title)
    setStatus(user.status)

  }

  const loadFeatures = async ()=>{

    const { data } = await supabase
      .from("features")
      .select("*")
      .order("name")

    if(data){
      setFeatures(data)
    }

    const { data: userFeatures } = await supabase
      .from("user_features")
      .select("*")
      .eq("user_id",user.id)

    if(userFeatures){

      const map:any = {}

      userFeatures.forEach((f:any)=>{
        map[f.feature_key] = true
      })

      setSelectedFeatures(map)

    }

  }

  const toggleFeature = (key:any)=>{

    setSelectedFeatures((prev:any)=>({

      ...prev,
      [key]: !prev[key]

    }))

  }

  const saveUser = async ()=>{

    const { error } = await supabase
      .from("company_users")
      .update({

        first_name:firstName,
        last_name:lastName,
        email:email,
        phone:phone,
        employee_number:employeeNumber,
        role:role,
        job_title:jobTitle,
        status:status

      })
      .eq("id",user.id)

    if(error){

      alert(error.message)
      return

    }

    await supabase
      .from("user_features")
      .delete()
      .eq("user_id",user.id)

    const rows = Object.keys(selectedFeatures)
      .filter(key => selectedFeatures[key])
      .map(key => ({
        user_id:user.id,
        feature_key:key
      }))

    if(rows.length){

      await supabase
        .from("user_features")
        .insert(rows)

    }

    await auditLog({

      action:"update_user",
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
        <input value={firstName} onChange={(e)=>setFirstName(e.target.value)} />

        <label>Last Name</label>
        <input value={lastName} onChange={(e)=>setLastName(e.target.value)} />

        <label>Email</label>
        <input value={email} onChange={(e)=>setEmail(e.target.value)} />

        <label>Phone</label>
        <input value={phone} onChange={(e)=>setPhone(e.target.value)} />

        <label>Employee Number</label>
        <input value={employeeNumber} onChange={(e)=>setEmployeeNumber(e.target.value)} />

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
            onClick={saveUser}
          >
            Save Changes
          </button>

        </div>

      </div>

    </div>

  )

}