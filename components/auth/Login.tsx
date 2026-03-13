"use client"

import { useState } from "react"
import { supabase } from "@/supabase/client"
import { auditLog } from "@/lib/audit/auditLogger"

import DevDashboard from "@/components/layouts/DevDashboard"
import AdminDashboard from "@/components/layouts/AdminDashboard"

import "@/styles/login.css"

export default function Login(){

  const [email,setEmail] = useState("")
  const [password,setPassword] = useState("")
  const [session,setSession] = useState<any>(null)
  const [role,setRole] = useState<any>(null)

  const [error,setError] = useState("")
  const [loading,setLoading] = useState(false)

  const handleLogin = async (e:any)=>{

    e.preventDefault()

    setLoading(true)
    setError("")

    const { data,error } =
      await supabase.auth.signInWithPassword({
        email,
        password
      })

    if(error){

      setError(error.message)
      setLoading(false)
      return

    }

    const user = data?.user

    if(!user){

      setError("Login failed")
      setLoading(false)
      return

    }

    /* CHECK SUPERUSER */

    const { data:superuser } = await supabase
      .from("superusers")
      .select("*")
      .eq("id",user.id)
      .single()

    if(superuser){

      await auditLog({
        userId:user.id,
        action:"login",
        description:"Superuser logged in"
      })

      setRole("superuser")
      setSession(data.session)
      setLoading(false)
      return

    }

    /* CHECK COMPANY USERS */

    const { data:companyUser } = await supabase
      .from("company_users")
      .select("*")
      .eq("id",user.id)
      .single()

    if(!companyUser){

      setError("Not authorised")
      setLoading(false)
      return

    }

    await auditLog({
      userId:user.id,
      companyId:companyUser.company_id,
      action:"login",
      description:`${companyUser.role} logged in`
    })

    setRole(companyUser.role)
    setSession(data.session)

    setLoading(false)

  }

  /* DASHBOARD ROUTING */

  if(session){

    if(role === "superuser"){
      return <DevDashboard/>
    }

    if(role === "admin"){
      return <AdminDashboard/>
    }

    if(role === "manager"){
      return <AdminDashboard/>
    }

    if(role === "employee"){
      return <div>Employee Dashboard Coming Soon</div>
    }

  }

  return(

    <div className="login-container">

      <div className="login-box">

        <h1 className="login-title">
          South Lincs Systems
        </h1>

        <form
          className="login-form"
          onSubmit={handleLogin}
        >

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

            <label>Password</label>

            <input
              type="password"
              value={password}
              onChange={(e)=>setPassword(e.target.value)}
              required
            />

          </div>

          {error && (
            <div className="login-error">
              {error}
            </div>
          )}

          <button
            className="login-button"
            disabled={loading}
          >
            {loading ? "Signing In..." : "Sign In"}
          </button>

        </form>

      </div>

    </div>

  )

}