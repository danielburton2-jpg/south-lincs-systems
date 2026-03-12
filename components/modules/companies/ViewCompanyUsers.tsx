"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/supabase/client"
import { auditLog } from "@/lib/audit/auditLogger"

import "@/styles/tables.css"

export default function ViewCompanyUsers({
  company,
  close,
  openEditUser
}: any){

  const [users,setUsers] = useState<any[]>([])

  useEffect(()=>{

    loadUsers()

  },[])

  const loadUsers = async ()=>{

    const { data,error } = await supabase
      .from("company_users")
      .select("*")
      .eq("company_id",company.id)
      .order("first_name")

    if(error){
      alert(error.message)
      return
    }

    if(data){
      setUsers(data)
    }

  }

  const toggleStatus = async(user:any,e:any)=>{

    e.stopPropagation()

    const newStatus =
      user.status === "active"
      ? "inactive"
      : "active"

    const { error } = await supabase
      .from("company_users")
      .update({ status:newStatus })
      .eq("id",user.id)

    if(error){
      alert(error.message)
      return
    }

    await auditLog({

      action:"update_user_status",
      table:"company_users",
      description:`Changed ${user.first_name} ${user.last_name} to ${newStatus}`,
      companyId:company.id,
      targetId:user.id

    })

    loadUsers()

  }

  const deleteUser = async(user:any,e:any)=>{

    e.stopPropagation()

    if(!confirm("Delete user?")) return

    const { error } = await supabase
      .from("company_users")
      .delete()
      .eq("id",user.id)

    if(error){
      alert(error.message)
      return
    }

    await auditLog({

      action:"delete_user",
      table:"company_users",
      description:`Deleted ${user.first_name} ${user.last_name}`,
      companyId:company.id,
      targetId:user.id

    })

    loadUsers()

  }

  return(

    <div className="table-container">

      <h1>{company.name} Users</h1>

      <table className="users-table">

        <thead>

          <tr>
            <th>Name</th>
            <th>Employee #</th>
            <th>Role</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>

        </thead>

        <tbody>

          {users.map((user:any)=>(

            <tr
              key={user.id}
              className="click-row"
              onClick={()=>openEditUser(user)}
            >

              <td>
                {user.first_name} {user.last_name}
              </td>

              <td>{user.employee_number}</td>

              <td>{user.role}</td>

              <td>{user.status}</td>

              <td className="actions">

                <button
                  className="secondary-button"
                  onClick={(e)=>toggleStatus(user,e)}
                >
                  {user.status === "active"
                    ? "Freeze"
                    : "Activate"}
                </button>

                <button
                  className="danger-button"
                  onClick={(e)=>deleteUser(user,e)}
                >
                  Delete
                </button>

              </td>

            </tr>

          ))}

        </tbody>

      </table>

      <div style={{marginTop:"20px"}}>

        <button
          className="secondary-button"
          onClick={close}
        >
          Back
        </button>

      </div>

    </div>

  )

}