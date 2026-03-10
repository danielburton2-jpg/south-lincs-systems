"use client"

import { useState } from "react"
import { supabase } from "@/supabase/client"
import { auditLog } from "@/lib/audit/auditLogger"

import DevDashboard from "@/components/layouts/DevDashboard"

import "@/styles/login.css"

export default function Login(){

  const [email,setEmail] = useState("")
  const [password,setPassword] = useState("")
  const [session,setSession] = useState<any>(null)
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

    if(user){

      const { data:superuser } = await supabase
        .from("superusers")
        .select("*")
        .eq("id",user.id)
        .single()

      if(!superuser){

        setError("Not authorised")
        setLoading(false)
        return

      }

      await auditLog(
        user.id,
        "login",
        "Superuser logged in"
      )

      setSession(data.session)

    }

    setLoading(false)

  }

  if(session){
    return <DevDashboard/>
  }

  return(

    <div className="login-container">

      <div className="login-box">

        <h1 className="login-title">
          South Lincs Systems
        </h1>

        <p className="login-subtitle">
          Superuser Login
        </p>

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