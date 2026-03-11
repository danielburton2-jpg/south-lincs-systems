"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/supabase/client"
import { auditLog } from "@/lib/audit/auditLogger"

import "@/styles/tables.css"

export default function ApproveRequests(){

  const [requests,setRequests] = useState<any[]>([])
  const [loading,setLoading] = useState(true)

  const loadRequests = async ()=>{

    const { data,error } = await supabase
      .from("time_requests")
      .select("*")
      .eq("status","pending")
      .order("created_at",{ascending:true})

    if(data){
      setRequests(data)
    }

    setLoading(false)

  }

  useEffect(()=>{

    loadRequests()

  },[])

  const updateStatus = async (
    id:string,
    status:string
  )=>{

    const { data:userData } =
      await supabase.auth.getUser()

    const user = userData?.user

    if(!user){
      return
    }

    const { error } = await supabase
      .from("time_requests")
      .update({
        status:status,
        manager_id:user.id,
        approved_at:new Date().toISOString()
      })
      .eq("id",id)

    if(error){
      alert(error.message)
      return
    }

    await auditLog(
      user.id,
      `request_${status}`,
      `Request ${status}`,
      "time_requests",
      id
    )

    loadRequests()

  }

  if(loading){
    return <p>Loading...</p>
  }

  return(

    <div>

      <h1>Approve Requests</h1>

      <table className="admin-table">

        <thead>

          <tr>

            <th>Type</th>
            <th>User</th>
            <th>Date</th>
            <th>Days</th>
            <th>Action</th>

          </tr>

        </thead>

        <tbody>

          {requests.map((req)=>{

            let dateDisplay = ""

            if(req.request_type === "holiday"){

              dateDisplay =
                `${req.start_date} → ${req.end_date}`

            } else {

              dateDisplay = req.request_date

            }

            return(

              <tr key={req.id}>

                <td>
                  {req.request_type}
                </td>

                <td>
                  {req.user_id}
                </td>

                <td>
                  {dateDisplay}
                </td>

                <td>
                  {req.days || "-"}
                </td>

                <td>

                  <button
                    onClick={()=>updateStatus(req.id,"approved")}
                  >
                    Approve
                  </button>

                  <button
                    onClick={()=>updateStatus(req.id,"rejected")}
                  >
                    Reject
                  </button>

                </td>

              </tr>

            )

          })}

        </tbody>

      </table>

    </div>

  )

}