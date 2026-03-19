"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/supabase/client"

import "@/styles/tables.css"

export default function MyRequests(){

  const [requests,setRequests] = useState<any[]>([])
  const [loading,setLoading] = useState(true)

  useEffect(()=>{

    const loadRequests = async ()=>{

      const { data:userData } =
        await supabase.auth.getUser()

      const user = userData?.user

      if(!user){
        return
      }

      const { data,error } = await supabase
        .from("time_requests")
        .select("*")
        .eq("user_id",user.id)
        .order("created_at",{ascending:false})

      if(error){
        console.log(error)
      }

      if(data){
        setRequests(data)
      }

      setLoading(false)

    }

    loadRequests()

  },[])

  if(loading){
    return <p>Loading...</p>
  }

  return(

    <div>

      <h1>My Requests</h1>

      <table className="admin-table">

        <thead>

          <tr>

            <th>Type</th>
            <th>Date</th>
            <th>Days</th>
            <th>Status</th>

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
                  {dateDisplay}
                </td>

                <td>
                  {req.days || "-"}
                </td>

                <td>

                  <span
                    className={
                      req.status === "approved"
                        ? "status-active"
                        : req.status === "rejected"
                        ? "status-frozen"
                        : ""
                    }
                  >

                    {req.status}

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