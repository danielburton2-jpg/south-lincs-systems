"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/supabase/client"

const months = [
  {value:1,label:"January"},
  {value:2,label:"February"},
  {value:3,label:"March"},
  {value:4,label:"April"},
  {value:5,label:"May"},
  {value:6,label:"June"},
  {value:7,label:"July"},
  {value:8,label:"August"},
  {value:9,label:"September"},
  {value:10,label:"October"},
  {value:11,label:"November"},
  {value:12,label:"December"},
]

export default function HolidaySettings(){

  const [companyId,setCompanyId] = useState<string | null>(null)

  const [startMonth,setStartMonth] = useState(1)
  const [endMonth,setEndMonth] = useState(12)

  const [allowHalf,setAllowHalf] = useState(true)
  const [allowEarly,setAllowEarly] = useState(true)

  const [loading,setLoading] = useState(true)
  const [saving,setSaving] = useState(false)

  useEffect(()=>{
    loadSettings()
  },[])

  /* LOAD SETTINGS */

  const loadSettings = async ()=>{

    setLoading(true)

    const { data:session } = await supabase.auth.getSession()
    const userId = session?.session?.user?.id

    if(!userId){
      setLoading(false)
      return
    }

    const { data:user } = await supabase
      .from("company_users")
      .select("company_id")
      .eq("id",userId)
      .single()

    if(!user){
      setLoading(false)
      return
    }

    console.log("Loaded companyId:", user.company_id)

    setCompanyId(user.company_id)

    const { data:settings } = await supabase
      .from("holiday_settings")
      .select("*")
      .eq("company_id",user.company_id)
      .maybeSingle()

    if(settings){

      setStartMonth(settings.holiday_start_month)
      setEndMonth(settings.holiday_end_month)
      setAllowHalf(settings.allow_half_days)
      setAllowEarly(settings.allow_early_finish)

    }

    setLoading(false)
  }

  /* SAVE SETTINGS */

  const saveSettings = async ()=>{

    if(!companyId){
      alert("Company not loaded yet")
      return
    }

    setSaving(true)

    const { error } = await supabase
      .from("holiday_settings")
      .upsert(
        {
          company_id: companyId,
          holiday_start_month: startMonth,
          holiday_end_month: endMonth,
          allow_half_days: allowHalf,
          allow_early_finish: allowEarly
        },
        {
          onConflict: "company_id" // 🔥 FIX FOR DUPLICATE ERROR
        }
      )

    if(error){
      console.error("Save error:", error)
      alert(error.message)
      setSaving(false)
      return
    }

    alert("Holiday settings saved")
    setSaving(false)
  }

  /* LOADING UI */

  if(loading){
    return <p>Loading settings...</p>
  }

  return(

    <div className="page-container">

      <h1>Holiday Settings</h1>

      <div className="form">

        {/* START MONTH */}

        <div className="form-group">
          <label>Holiday Year Start</label>
          <select
            value={startMonth}
            onChange={(e)=>setStartMonth(Number(e.target.value))}
          >
            {months.map(m=>(
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* END MONTH */}

        <div className="form-group">
          <label>Holiday Year End</label>
          <select
            value={endMonth}
            onChange={(e)=>setEndMonth(Number(e.target.value))}
          >
            {months.map(m=>(
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* HALF DAYS */}

        <div className="form-group">
          <label>
            <input
              type="checkbox"
              checked={allowHalf}
              onChange={(e)=>setAllowHalf(e.target.checked)}
            />
            Allow Half Days
          </label>
        </div>

        {/* EARLY FINISH */}

        <div className="form-group">
          <label>
            <input
              type="checkbox"
              checked={allowEarly}
              onChange={(e)=>setAllowEarly(e.target.checked)}
            />
            Allow Early Finish
          </label>
        </div>

        {/* SAVE BUTTON */}

        <button
          className="primary-button"
          onClick={saveSettings}
          disabled={!companyId || saving}
        >
          {saving ? "Saving..." : "Save Settings"}
        </button>

      </div>

    </div>

  )

}