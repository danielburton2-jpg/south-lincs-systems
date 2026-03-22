"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/supabase/client"

import "@/styles/request-time.css"

export default function RequestTime({ user, close }: any){

  const [companyId,setCompanyId] = useState<string | null>(null)

  const [type,setType] = useState<"full" | "half" | "early">("full")

  const [startDate,setStartDate] = useState("")
  const [endDate,setEndDate] = useState("")

  const [singleDate,setSingleDate] = useState("")
  const [halfDayPeriod,setHalfDayPeriod] = useState("am")

  const [finishTime,setFinishTime] = useState("")

  const [reason,setReason] = useState("")

  const [allowHalf,setAllowHalf] = useState(false)
  const [allowEarly,setAllowEarly] = useState(false)

  const [loading,setLoading] = useState(false)

  /* 🔥 BALANCE */
  const [entitlement,setEntitlement] = useState(0)
  const [used,setUsed] = useState(0)

  /* =========================
     LOAD DATA
  ========================= */

  useEffect(()=>{

    const load = async ()=>{

      const { data:userData } = await supabase.auth.getUser()
      const userId = userData?.user?.id
      if(!userId) return

      const { data:userRow } = await supabase
        .from("company_users")
        .select("id, company_id, holiday_entitlement")
        .eq("auth_user_id",userId)
        .single()

      if(!userRow) return

      setCompanyId(userRow.company_id)
      setEntitlement(userRow.holiday_entitlement || 0)

      /* SETTINGS */

      const { data:settings } = await supabase
        .from("holiday_settings")
        .select("*")
        .eq("company_id",userRow.company_id)
        .maybeSingle()

      if(settings){
        setAllowHalf(settings.allow_half_days)
        setAllowEarly(settings.allow_early_finish)
      }

      /* 🔥 USED DAYS */

      const { data:requests } = await supabase
        .from("holiday_requests")
        .select("start_date,end_date,status")
        .eq("user_id",userRow.id)
        .eq("status","approved")

      const calculateDays = (start:string,end:string)=>{
        const s = new Date(start)
        const e = new Date(end)
        return Math.ceil((e.getTime()-s.getTime())/(1000*60*60*24)) + 1
      }

      let totalUsed = 0

      requests?.forEach((r:any)=>{
        totalUsed += calculateDays(r.start_date,r.end_date)
      })

      setUsed(totalUsed)

    }

    load()

  },[])

  const remaining = entitlement - used

  /* =========================
     SUBMIT
  ========================= */

  const submitRequest = async ()=>{

    if(!companyId){
      alert("Company not loaded")
      return
    }

    setLoading(true)

    let payload:any = {
      user_id: user.id,
      company_id: companyId,
      reason,
      status: "pending"
    }

    /* FULL DAY */

    if(type === "full"){

      const calculateDays = (start:string,end:string)=>{
        const s = new Date(start)
        const e = new Date(end)
        return Math.ceil((e.getTime()-s.getTime())/(1000*60*60*24)) + 1
      }

      const requestedDays = calculateDays(startDate,endDate)

      if(requestedDays > remaining){
        alert("Not enough holiday remaining")
        setLoading(false)
        return
      }

      const { error } = await supabase
        .from("holiday_requests")
        .insert({
          ...payload,
          start_date: startDate,
          end_date: endDate
        })

      if(error){
        alert(error.message)
        setLoading(false)
        return
      }

    }

    /* HALF DAY */

    if(type === "half"){

      const { error } = await supabase
        .from("time_requests")
        .insert({
          ...payload,
          date: singleDate,
          type: "half_day",
          period: halfDayPeriod
        })

      if(error){
        alert(error.message)
        setLoading(false)
        return
      }

    }

    /* EARLY FINISH */

    if(type === "early"){

      const { error } = await supabase
        .from("time_requests")
        .insert({
          ...payload,
          date: singleDate,
          type: "early_finish",
          finish_time: finishTime
        })

      if(error){
        alert(error.message)
        setLoading(false)
        return
      }

    }

    alert("Request submitted")
    setLoading(false)
    close()

  }

  /* =========================
     UI
  ========================= */

  return(

    <div className="page-container">

      <h1>Request Time Off</h1>

      {/* 🔥 BALANCE BAR */}

      <div className="balance-bar">

        <div className="balance-item">
          <span>Total</span>
          <strong>{entitlement}</strong>
        </div>

        <div className="balance-item">
          <span>Used</span>
          <strong>{used}</strong>
        </div>

        <div className="balance-item">
          <span>Remaining</span>
          <strong className={remaining <= 3 ? "low" : ""}>
            {remaining}
          </strong>
        </div>

      </div>

      {/* TYPE SELECTOR */}

      <div className="type-selector">

        <button
          className={type === "full" ? "active" : ""}
          onClick={()=>setType("full")}
        >
          Full Day
        </button>

        {allowHalf && (
          <button
            className={type === "half" ? "active" : ""}
            onClick={()=>setType("half")}
          >
            Half Day
          </button>
        )}

        {allowEarly && (
          <button
            className={type === "early" ? "active" : ""}
            onClick={()=>setType("early")}
          >
            Early Finish
          </button>
        )}

      </div>

      {/* FULL DAY */}

      {type === "full" && (
        <>
          <div className="form-group">
            <label>Start Date</label>
            <input type="date" value={startDate} onChange={(e)=>setStartDate(e.target.value)} />
          </div>

          <div className="form-group">
            <label>End Date</label>
            <input type="date" value={endDate} onChange={(e)=>setEndDate(e.target.value)} />
          </div>
        </>
      )}

      {/* HALF DAY */}

      {type === "half" && (
        <>
          <div className="form-group">
            <label>Date</label>
            <input type="date" value={singleDate} onChange={(e)=>setSingleDate(e.target.value)} />
          </div>

          <div className="form-group">
            <label>AM / PM</label>
            <select value={halfDayPeriod} onChange={(e)=>setHalfDayPeriod(e.target.value)}>
              <option value="am">AM</option>
              <option value="pm">PM</option>
            </select>
          </div>
        </>
      )}

      {/* EARLY FINISH */}

      {type === "early" && (
        <>
          <div className="form-group">
            <label>Date</label>
            <input type="date" value={singleDate} onChange={(e)=>setSingleDate(e.target.value)} />
          </div>

          <div className="form-group">
            <label>Finish Time</label>
            <input type="time" value={finishTime} onChange={(e)=>setFinishTime(e.target.value)} />
          </div>
        </>
      )}

      {/* REASON */}

      <div className="form-group">
        <label>Reason</label>
        <textarea value={reason} onChange={(e)=>setReason(e.target.value)} />
      </div>

      {/* BUTTONS */}

      <div className="form-buttons">

        <button onClick={close}>
          Cancel
        </button>

        <button onClick={submitRequest} disabled={loading}>
          {loading ? "Submitting..." : "Submit"}
        </button>

      </div>

    </div>

  )

}