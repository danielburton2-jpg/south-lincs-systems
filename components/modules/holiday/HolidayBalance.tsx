"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/supabase/client"

import "@/styles/dashboard.css"
import "@/styles/tables.css"

export default function HolidayBalance(){

  const [balance,setBalance] = useState<any>(null)
  const [loading,setLoading] = useState(true)

  useEffect(()=>{

    const loadBalance = async ()=>{

      const { data:userData } =
        await supabase.auth.getUser()

      const user = userData?.user

      if(!user){
        return
      }

      const year = new Date().getFullYear()

      const { data,error } = await supabase
        .from("holiday_balances")
        .select("*")
        .eq("user_id",user.id)
        .eq("year",year)
        .single()

      if(data){
        setBalance(data)
      }

      setLoading(false)

    }

    loadBalance()

  },[])

  if(loading){
    return <p>Loading...</p>
  }

  if(!balance){
    return <p>No holiday balance found</p>
  }

  return(

    <div className="dashboard-cards">

      <div className="dashboard-card">

        <h3>Total Allowance</h3>

        <p>{balance.total_days} days</p>

      </div>

      <div className="dashboard-card">

        <h3>Used</h3>

        <p>{balance.used_days} days</p>

      </div>

      <div className="dashboard-card">

        <h3>Remaining</h3>

        <p>{balance.remaining_days} days</p>

      </div>

    </div>

  )

}