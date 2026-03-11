"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/supabase/client"

import "@/styles/tables.css"

export default function HolidayCalendar(){

  const [requests,setRequests] = useState<any[]>([])
  const [loading,setLoading] = useState(true)

  useEffect(()=>{

    const loadCalendar = async ()=>{

      const { data,error } = await supabase
        .from("time_requests")
        .select("*")
        .eq("status","approved")
        .order("created_at",{ascending:false})

      if(data){
        setRequests(data)
      }

      setLoading(false)

    }

    loadCalendar()

  },[])

  if(loading){
    return <p>Loading...</p>
  }

  return(

    <div>

      <h1>Holiday Calendar</h1>

      <table className="admin-table">

        <thead>

          <tr>

            <th>User</th>
            <th>Type</th>
            <th>Date</th>
            <th>Days</th>

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

                <td>{req.user_id}</td>

                <td>{req.request_type}</td>

                <td>{dateDisplay}</td>

                <td>{req.days || "-"}</td>

              </tr>

            )

          })}

        </tbody>

      </table>

    </div>

  )

}