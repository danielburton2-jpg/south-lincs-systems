"use client"

import { useState } from "react"
import { supabase } from "@/supabase/client"
import { auditLog } from "@/lib/audit/auditLogger"

import "@/styles/forms.css"

export default function RequestTime(){

  const [type,setType] = useState("holiday")
  const [startDate,setStartDate] = useState("")
  const [endDate,setEndDate] = useState("")
  const [requestDate,setRequestDate] = useState("")
  const [reason,setReason] = useState("")

  const [loading,setLoading] = useState(false)

  const submitRequest = async (e:any)=>{

    e.preventDefault()

    setLoading(true)

    const { data } = await supabase.auth.getUser()

    const user = data?.user

    if(!user){
      alert("Not logged in")
      return
    }

    let days = null

    if(type === "half_day"){
      days = 0.5
    }

    if(type === "holiday" && startDate && endDate){

      const start = new Date(startDate)
      const end = new Date(endDate)

      const diff =
        (end.getTime() - start.getTime())
        / (1000 * 3600 * 24)

      days = diff + 1

    }

    const { error } = await supabase
      .from("time_requests")
      .insert([
        {
          user_id:user.id,
          request_type:type,
          start_date:startDate || null,
          end_date:endDate || null,
          request_date:requestDate || null,
          days:days,
          reason:reason
        }
      ])

    if(error){
      alert(error.message)
      setLoading(false)
      return
    }

    await auditLog(
      user.id,
      "create_request",
      `Created ${type} request`,
      "time_requests",
      user.id
    )

    alert("Request submitted")

    setLoading(false)

  }

  return(

    <div className="form-container">

      <h1>Request Time</h1>

      <form
        className="stack-form"
        onSubmit={submitRequest}
      >

        <label>Request Type</label>

        <select
          value={type}
          onChange={(e)=>setType(e.target.value)}
        >

          <option value="holiday">
            Holiday
          </option>

          <option value="half_day">
            Half Day
          </option>

          <option value="early_finish">
            Early Finish
          </option>

        </select>

        {type === "holiday" && (

          <>
            <label>Start Date</label>

            <input
              type="date"
              value={startDate}
              onChange={(e)=>setStartDate(e.target.value)}
            />

            <label>End Date</label>

            <input
              type="date"
              value={endDate}
              onChange={(e)=>setEndDate(e.target.value)}
            />
          </>

        )}

        {(type === "half_day" || type === "early_finish") && (

          <>
            <label>Date</label>

            <input
              type="date"
              value={requestDate}
              onChange={(e)=>setRequestDate(e.target.value)}
            />
          </>

        )}

        <label>Reason</label>

        <textarea
          value={reason}
          onChange={(e)=>setReason(e.target.value)}
        />

        <div className="form-buttons">

          <button type="submit" disabled={loading}>
            {loading ? "Submitting..." : "Submit"}
          </button>

        </div>

      </form>

    </div>

  )

}