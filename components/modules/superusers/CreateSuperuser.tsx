"use client"

import { useState } from "react"
import { supabase } from "@/supabase/client"
import { auditLog } from "@/lib/audit/auditLogger"

import "@/styles/forms.css"

export default function CreateSuperuser({ close }: any){

  const [firstName,setFirstName] = useState("")
  const [lastName,setLastName] = useState("")
  const [email,setEmail] = useState("")
  const [password,setPassword] = useState("")
  const [loading,setLoading] = useState(false)
  const [error,setError] = useState("")

  const createUser = async (e:any)=>{

    e.preventDefault()

    setLoading(true)
    setError("")

    /* CURRENT USER (for audit log) */

    const { data:sessionData } =
      await supabase.auth.getSession()

    const currentUser =
      sessionData?.session?.user?.id

    /* CREATE AUTH USER */

    const { data, error:authError } =
      await supabase.auth.signUp({

        email: email,
        password: password

      })

    if(authError){

      setError(authError.message)
      setLoading(false)
      return

    }

    const userId = data?.user?.id

    if(!userId){

      setError("User creation failed")
      setLoading(false)
      return

    }

    /* INSERT INTO SUPERUSERS */

    const { error:dbError } = await supabase
      .from("superusers")
      .insert([
        {
          id:userId,
          email:email,
          first_name:firstName,
          last_name:lastName
        }
      ])

    if(dbError){

      setError(dbError.message)
      setLoading(false)
      return

    }

    /* WRITE AUDIT LOG */

    if(currentUser){

      await auditLog(
        currentUser,
        "create_superuser",
        `Created superuser ${firstName} ${lastName}`
      )

    }

    /* RESET FORM */

    setFirstName("")
    setLastName("")
    setEmail("")
    setPassword("")

    setLoading(false)

    /* CLOSE FORM */

    close()

  }

  return(

    <div className="form-container">

      <h1>Create Superuser</h1>

      <form
        className="stack-form"
        autoComplete="off"
        onSubmit={createUser}
      >

        <label>First Name</label>
        <input
          value={firstName}
          onChange={(e)=>setFirstName(e.target.value)}
          required
        />

        <label>Last Name</label>
        <input
          value={lastName}
          onChange={(e)=>setLastName(e.target.value)}
          required
        />

        <label>Email</label>
        <input
          type="email"
          autoComplete="new-email"
          value={email}
          onChange={(e)=>setEmail(e.target.value)}
          required
        />

        <label>Password</label>
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e)=>setPassword(e.target.value)}
          required
        />

        {error && (
          <div style={{color:"red"}}>
            {error}
          </div>
        )}

        <div className="form-buttons">

          <button
            type="submit"
            disabled={loading}
          >
            {loading ? "Creating..." : "Submit"}
          </button>

          <button
            type="button"
            onClick={close}
          >
            Cancel
          </button>

        </div>

      </form>

    </div>

  )

}