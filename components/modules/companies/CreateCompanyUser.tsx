"use client"

import { useState } from "react"

export default function CreateCompanyUser({ companyId, close }: any){

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

  const handleCreateUser = async (e:any)=>{

    e.preventDefault()

    console.log("Company ID:",companyId)

    if(!companyId){
      alert("Company ID missing")
      return
    }

    if(password !== confirmPassword){
      alert("Passwords do not match")
      return
    }

    const res = await fetch("/api/admin/create-user",{
      method:"POST",
      headers:{
        "Content-Type":"application/json"
      },
      body: JSON.stringify({

        first_name: firstName,
        last_name: lastName,
        email,
        password,
        role,

        company_id: companyId,

        phone,
        employee_number: employeeNumber,
        job_title: jobTitle,
        status

      })
    })

    const data = await res.json()

    if(!res.ok){
      alert(data.error)
      return
    }

    alert("User Created")

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

  }

  return(

    <div className="page-container">

      <h1 className="page-title">
        Create User
      </h1>

      <form className="form" onSubmit={handleCreateUser}>

        <div className="form-group">
          <label>First Name</label>
          <input
            value={firstName}
            onChange={(e)=>setFirstName(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label>Last Name</label>
          <input
            value={lastName}
            onChange={(e)=>setLastName(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e)=>setEmail(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label>Phone</label>
          <input
            value={phone}
            onChange={(e)=>setPhone(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>Employee Number</label>
          <input
            value={employeeNumber}
            onChange={(e)=>setEmployeeNumber(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>Role</label>
          <select
            value={role}
            onChange={(e)=>setRole(e.target.value)}
            required
          >
            <option value="">Select Role</option>
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="employee">Employee</option>
          </select>
        </div>

        <div className="form-group">
          <label>Job Title</label>
          <input
            value={jobTitle}
            onChange={(e)=>setJobTitle(e.target.value)}
          />
        </div>

        <h2 className="section-title">
          Security
        </h2>

        <div className="form-group">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e)=>setPassword(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label>Confirm Password</label>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e)=>setConfirmPassword(e.target.value)}
            required
          />
        </div>

        <div className="form-group">
          <label>Status</label>
          <select
            value={status}
            onChange={(e)=>setStatus(e.target.value)}
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        <div className="form-buttons">

          <button
            type="button"
            className="cancel-btn"
            onClick={close}
          >
            Cancel
          </button>

          <button
            type="submit"
            className="create-btn"
          >
            Create User
          </button>

        </div>

      </form>

    </div>

  )

}