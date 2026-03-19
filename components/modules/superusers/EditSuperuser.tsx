"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/supabase/client"
import { auditLog } from "@/lib/audit/auditLogger"

import "@/styles/forms.css"

export default function EditSuperuser({ user, close }: any){

  const [firstName,setFirstName] = useState(user.first_name)
  const [lastName,setLastName] = useState(user.last_name)
  const [email,setEmail] = useState(user.email)
  const [password,setPassword] = useState("")
  const [frozen,setFrozen] = useState(user.frozen)

  const [currentUserId,setCurrentUserId] = useState<string | null>(null)

  const [showDeleteBox,setShowDeleteBox] = useState(false)
  const [confirmPassword,setConfirmPassword] = useState("")

  const [loading,setLoading] = useState(false)

  useEffect(()=>{

    const getCurrentUser = async ()=>{

      const { data } = await supabase.auth.getUser()

      const id = data?.user?.id

      if(id){
        setCurrentUserId(id)
      }

    }

    getCurrentUser()

  },[])

  const saveUser = async (e:any)=>{

    e.preventDefault()

    setLoading(true)

    const { data:sessionData } =
      await supabase.auth.getSession()

    const currentUser =
      sessionData?.session?.user?.id

    const oldName =
      `${user.first_name} ${user.last_name}`

    const newName =
      `${firstName} ${lastName}`

    if(currentUser && user.id === currentUser && frozen){

      alert("You cannot freeze your own account")

      setFrozen(false)
      setLoading(false)
      return

    }

    await supabase
      .from("superusers")
      .update({
        first_name:firstName,
        last_name:lastName,
        email:email,
        frozen:frozen
      })
      .eq("id",user.id)

    if(password){

      await supabase.auth.updateUser({
        password:password
      })

      if(currentUser){

        await auditLog(
          currentUser,
          "change_password",
          `Password changed for ${newName}`,
          "superusers",
          user.id
        )

      }

    }

    if(oldName !== newName && currentUser){

      await auditLog(
        currentUser,
        "change_name",
        `Changed name from ${oldName} to ${newName}`,
        "superusers",
        user.id
      )

    }

    if(user.frozen !== frozen && currentUser){

      const action =
        frozen ? "freeze_superuser" : "unfreeze_superuser"

      const text =
        frozen
        ? `Superuser ${newName} was frozen`
        : `Superuser ${newName} was unfrozen`

      await auditLog(
        currentUser,
        action,
        text,
        "superusers",
        user.id
      )

    }

    setLoading(false)

    close()

  }

  const confirmDeleteUser = async ()=>{

    if(currentUserId && user.id === currentUserId){

      alert("You cannot delete your own account")
      return

    }

    const { data:sessionData } =
      await supabase.auth.getSession()

    const currentEmail =
      sessionData?.session?.user?.email

    const { error } =
      await supabase.auth.signInWithPassword({
        email:currentEmail!,
        password:confirmPassword
      })

    if(error){

      alert("Incorrect password")
      return

    }

    const currentUser =
      sessionData?.session?.user?.id

    await supabase
      .from("superusers")
      .update({
        deleted:true,
        frozen:true,
        deleted_at:new Date().toISOString()
      })
      .eq("id",user.id)

    if(currentUser){

      await auditLog(
        currentUser,
        "delete_superuser",
        `Soft deleted superuser ${user.first_name} ${user.last_name}`,
        "superusers",
        user.id
      )

    }

    close()

  }

  return(

    <div className="form-container">

      <h1>Edit Superuser</h1>

      <form
        className="stack-form"
        autoComplete="off"
        onSubmit={saveUser}
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
          value={email}
          onChange={(e)=>setEmail(e.target.value)}
          required
        />

        <label>Password</label>
        <input
          type="password"
          placeholder="Leave blank to keep current"
          value={password}
          onChange={(e)=>setPassword(e.target.value)}
        />

        <label>Status</label>

        <select
          value={frozen ? "frozen" : "active"}
          onChange={(e)=>
            setFrozen(e.target.value === "frozen")
          }
        >

          <option value="active">Active</option>
          <option value="frozen">Frozen</option>

        </select>

        <div className="form-buttons">

          <button
            type="submit"
            disabled={loading}
          >
            {loading ? "Saving..." : "Submit"}
          </button>

          <button
            type="button"
            onClick={close}
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={()=>setShowDeleteBox(true)}
            style={{background:"#dc2626"}}
          >
            Delete
          </button>

        </div>

      </form>

      {showDeleteBox && (

        <div className="delete-box">

          <h3>Confirm Delete</h3>

          <p>Enter your password to delete this user</p>

          <input
            type="password"
            value={confirmPassword}
            onChange={(e)=>setConfirmPassword(e.target.value)}
          />

          <div className="form-buttons">

            <button onClick={confirmDeleteUser}>
              Confirm Delete
            </button>

            <button onClick={()=>setShowDeleteBox(false)}>
              Cancel
            </button>

          </div>

        </div>

      )}

    </div>

  )

}