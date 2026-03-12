"use client"

import { useState } from "react"
import { supabase } from "@/supabase/client"
import { auditLog } from "@/lib/audit/auditLogger"

import "@/styles/forms.css"

export default function RequestTime({ user, close }: any){

  const [startDate,setStartDate] = useState("")
  const [endDate,setEndDate] = useState("")
  const [reason,setReason] = useState("")
  const [loading,setLoading] = useState(false)

  const submitRequest = async ()=>{

    if(!startDate || !endDate){
      alert("Please select dates")
      return
    }

    setLoading(true)

    const { data,error } = await supabase
      .from("holiday_requests")
      .insert({

        user_id: user.id,
        company_id: user.company_id,
        start_date: startDate,
        end_date: endDate,
        reason: reason,
        status: "pending"

      })
      .select()
      .single()

    if(error){

      alert(error.message)
      setLoading(false)
      return

    }

    /* AUDIT LOG */

    await auditLog({

      action: "request_holiday",
      table: "holiday_requests",
      description: `Holiday requested ${startDate} → ${endDate}`,
      companyId: user.company_id,
      targetId: data.id

    })

    setLoading(false)
    close()

  }

  return(

    <div className="form-container">

      <h1>Request Holiday</h1>

      <div className="stack-form">

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

        <label>Reason</label>
        <textarea
          value={reason}
          onChange={(e)=>setReason(e.target.value)}
        />

        <div className="form-buttons">

          <button
            className="secondary-button"
            onClick={close}
          >
            Cancel
          </button>

          <button
            className="primary-button"
            onClick={submitRequest}
            disabled={loading}
          >
            Submit Request
          </button>

        </div>

      </div>

    </div>

  )

}