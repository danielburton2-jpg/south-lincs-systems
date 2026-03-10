"use client"

import { useState } from "react"
import { supabase } from "@/supabase/client"
import { auditLog } from "@/lib/audit/auditLogger"

import "@/styles/forms.css"

export default function EditSuperuser({ user, close }: any){

  const [firstName,setFirstName] = useState(user.first_name)
  const [lastName,setLastName] = useState(user.last_name)
  const [email,setEmail] = useState(user.email)
  const [password,setPassword] = useState("")
  const [frozen,setFrozen] = useState(user.frozen)

  const [loading,setLoading] = useState(false)

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

    /* UPDATE SUPERUSER */

    await supabase
      .from("superusers")
      .update({
        first_name:firstName,
        last_name:lastName,
        email:email,
        frozen:frozen
      })
      .eq("id",user.id)

    /* PASSWORD CHANGE */

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

    /* NAME CHANGE */

    if(oldName !== newName && currentUser){

      await auditLog(
        currentUser,
        "change_name",
        `Changed name from ${oldName} to ${newName}`,
        "superusers",
        user.id
      )

    }

    /* FREEZE / UNFREEZE */

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

  const deleteUser = async ()=>{

    const confirmDelete =
      confirm("Delete this superuser?")

    if(!confirmDelete) return

    const { data:sessionData } =
      await supabase.auth.getSession()

    const currentUser =
      sessionData?.session?.user?.id

    await supabase
      .from("superusers")
      .delete()
      .eq("id",user.id)

    if(currentUser){

      await auditLog(
        currentUser,
        "delete_superuser",
        `Deleted superuser ${user.first_name} ${user.last_name}`,
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
            onClick={deleteUser}
            style={{background:"#dc2626"}}
          >
            Delete
          </button>

        </div>

      </form>

    </div>

  )

}