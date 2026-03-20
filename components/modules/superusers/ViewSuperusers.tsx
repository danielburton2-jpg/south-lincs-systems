"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/supabase/client"

import "@/styles/tables.css"

export default function ViewSuperusers({ openEdit }: any){

  const [users,setUsers] = useState<any[]>([])

  useEffect(()=>{

    const loadUsers = async ()=>{

      const { data, error } = await supabase
        .from("superusers")
        .select("*")
        .order("first_name")

      console.log("SUPERUSERS:", data, error)

      if(data){
        setUsers(data)
      }

    }

    loadUsers()

  },[])

  return(

    <div>

      <h1>Superusers</h1>

      <table className="admin-table">

        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Status</th>
          </tr>
        </thead>

        <tbody>

          {users.map((user)=>{

            const status =
              user.frozen ? "Frozen" : "Active"

            return(

              <tr
                key={user.id}
                className="click-row"
                onClick={()=>openEdit(user)}
              >

                <td>
                  {user.first_name} {user.last_name}
                </td>

                <td>{user.email}</td>

                <td>
                  <span className={
                    user.frozen
                      ? "status-frozen"
                      : "status-active"
                  }>
                    {status}
                  </span>
                </td>

              </tr>

            )

          })}

        </tbody>

      </table>

    </div>

  )

}