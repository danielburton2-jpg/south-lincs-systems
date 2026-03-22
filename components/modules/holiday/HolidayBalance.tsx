"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/supabase/client"

export default function HolidayBalance() {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)

      // 🔹 STEP 1: GET LOGGED IN USER
      const { data: authData, error: authError } = await supabase.auth.getUser()

      if (authError || !authData?.user) {
        console.error("Auth error:", authError)
        setLoading(false)
        return
      }

      const authUserId = authData.user.id
      console.log("AUTH USER:", authUserId)

      // 🔹 STEP 2: GET COMPANY
      const { data: me, error: meError } = await supabase
        .from("company_users")
        .select("company_id")
        .eq("auth_user_id", authUserId)
        .single()

      console.log("ME:", me)

      if (meError || !me?.company_id) {
        console.error("No company found")
        setLoading(false)
        return
      }

      const companyId = me.company_id
      console.log("COMPANY ID:", companyId)

      // 🔹 STEP 3: GET USERS (ONLY HOLIDAY ENABLED)
      const { data: usersData, error: usersError } = await supabase
        .from("company_users")
        .select(`
          id,
          first_name,
          last_name,
          job_title,
          holiday_entitlement,
          holiday_enabled
        `)
        .eq("company_id", companyId)
        .eq("holiday_enabled", true)

      console.log("USERS:", usersData)

      if (usersError) {
        console.error(usersError)
        setLoading(false)
        return
      }

      // 🔹 STEP 4: GET APPROVED HOLIDAYS
      const { data: holidayData, error: holidayError } = await supabase
        .from("holiday_requests")
        .select("user_id,start_date,end_date,status")
        .eq("company_id", companyId)
        .eq("status", "approved")

      console.log("HOLIDAYS:", holidayData)

      if (holidayError) {
        console.error(holidayError)
      }

      // 🔹 STEP 5: CALCULATE USED DAYS
      const calculateDays = (start: string, end: string) => {
        const s = new Date(start)
        const e = new Date(end)
        return Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1
      }

      const results = (usersData || []).map((u: any) => {
        const userRequests = (holidayData || []).filter(
          (r: any) => r.user_id === u.id
        )

        let used = 0
        userRequests.forEach((r: any) => {
          used += calculateDays(r.start_date, r.end_date)
        })

        return {
          id: u.id,
          name: `${u.first_name} ${u.last_name}`,
          job: u.job_title || "-",
          entitlement: u.holiday_entitlement || 0,
          used,
          remaining: (u.holiday_entitlement || 0) - used,
        }
      })

      setRows(results)
      setLoading(false)
    }

    load()
  }, [])

  if (loading) {
    return <p>Loading holiday balances...</p>
  }

  return (
    <div className="page-container">
      <h1 className="page-title">Holiday Balances</h1>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Job</th>
            <th>Entitlement</th>
            <th>Used</th>
            <th>Remaining</th>
          </tr>
        </thead>

        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={5}>No users found</td>
            </tr>
          )}

          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.name}</td>
              <td>{row.job}</td>
              <td>{row.entitlement}</td>
              <td>{row.used}</td>
              <td>{row.remaining}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}