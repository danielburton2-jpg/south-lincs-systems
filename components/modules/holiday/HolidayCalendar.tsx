"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/supabase/client"

import "@/styles/calendar.css"

export default function HolidayCalendar(){

  const [companyId,setCompanyId] = useState<string | null>(null)
  const [users,setUsers] = useState<any[]>([])
  const [requests,setRequests] = useState<any[]>([])
  const [selected,setSelected] = useState<any>(null)

  const [month,setMonth] = useState(new Date())

  const year = month.getFullYear()
  const monthIndex = month.getMonth()
  const daysInMonth = new Date(year,monthIndex+1,0).getDate()

  useEffect(()=>{
    loadCompany()
  },[])

  useEffect(()=>{
    if(companyId){
      loadData()
    }
  },[companyId,month])

  /* =========================
     LOAD COMPANY
  ========================= */

  const loadCompany = async ()=>{

    const { data:userData } = await supabase.auth.getUser()
    const userId = userData?.user?.id

    if(!userId) return

    const { data:me } = await supabase
      .from("company_users")
      .select("company_id")
      .eq("auth_user_id",userId)
      .single()

    if(me?.company_id){
      setCompanyId(me.company_id)
    }
  }

  /* =========================
     LOAD USERS + REQUESTS
  ========================= */

  const loadData = async ()=>{

    const { data:usersData } = await supabase
      .from("company_users")
      .select("*")
      .eq("company_id",companyId)
      .order("first_name")

    if(usersData) setUsers(usersData)

    const { data:reqData } = await supabase
      .from("holiday_requests")
      .select("*")
      .eq("company_id",companyId)

    if(reqData) setRequests(reqData)
  }

  /* =========================
     CELL TYPE LOGIC
  ========================= */

  const getCell = (userId:any,day:number)=>{

    const date = new Date(year,monthIndex,day)

    const req = requests.find((r:any)=>{

      const start = new Date(r.start_date)
      const end = new Date(r.end_date)

      return r.user_id === userId &&
      date >= start && date <= end
    })

    if(!req) return ""

    if(req.status === "pending") return "pending"
    if(req.status === "rejected") return "rejected"

    if(req.type === "half_day") return "half"
    if(req.type === "early_finish") return "early"

    return "approved"
  }

  /* =========================
     ACTIONS
  ========================= */

  const approve = async(id:any)=>{
    await supabase
      .from("holiday_requests")
      .update({ status:"approved" })
      .eq("id",id)

    setSelected(null)
    loadData()
  }

  const reject = async(id:any)=>{
    await supabase
      .from("holiday_requests")
      .update({ status:"rejected" })
      .eq("id",id)

    setSelected(null)
    loadData()
  }

  const cancel = async(id:any)=>{
    await supabase
      .from("holiday_requests")
      .delete()
      .eq("id",id)

    setSelected(null)
    loadData()
  }

  /* =========================
     NAV
  ========================= */

  const nextMonth = ()=> setMonth(new Date(year,monthIndex+1,1))
  const prevMonth = ()=> setMonth(new Date(year,monthIndex-1,1))

  /* =========================
     UI
  ========================= */

  return(

    <div className="calendar-wrapper">

      <div className="calendar-header">
        <button onClick={prevMonth}>Prev</button>
        <h2>{month.toLocaleString("default",{month:"long"})} {year}</h2>
        <button onClick={nextMonth}>Next</button>
      </div>

      <div className="calendar-grid">

        {/* HEADER ROW */}
        <div className="calendar-row header">
          <div className="user-cell">User</div>

          {Array.from({length:daysInMonth},(_,i)=>(
            <div key={i} className="day-cell">
              {i+1}
            </div>
          ))}
        </div>

        {/* USERS */}

        {users.map(u=>(

          <div key={u.id} className="calendar-row">

            <div className="user-cell">
              {u.first_name} {u.last_name}
            </div>

            {Array.from({length:daysInMonth},(_,i)=>{

              const day = i+1
              const type = getCell(u.id,day)

              return(
                <div
                  key={i}
                  className={`cell ${type}`}
                  onClick={()=>{

                    const req = requests.find((r:any)=>r.user_id === u.id)
                    if(req) setSelected(req)

                  }}
                />
              )

            })}

          </div>

        ))}

      </div>

      {/* POPUP */}

      {selected && (

        <div className="popup">

          <h3>Request</h3>

          <p>{selected.start_date} → {selected.end_date}</p>

          {selected.status === "pending" && (
            <>
              <button onClick={()=>approve(selected.id)}>Approve</button>
              <button onClick={()=>reject(selected.id)}>Reject</button>
            </>
          )}

          <button onClick={()=>cancel(selected.id)}>Cancel</button>

          <button onClick={()=>setSelected(null)}>Close</button>

        </div>

      )}

    </div>

  )

}