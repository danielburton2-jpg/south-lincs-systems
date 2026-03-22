"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/supabase/client"

import "@/styles/tables.css"

export default function ApproveRequests(){

  const [requests,setRequests] = useState<any[]>([])
  const [currentUserId,setCurrentUserId] = useState<string | null>(null)
  const [companyId,setCompanyId] = useState<string | null>(null)
  const [loading,setLoading] = useState(true)

  /* LOAD USER + COMPANY */

  useEffect(()=>{
    loadUserAndCompany()
  },[])

  const loadUserAndCompany = async ()=>{

    const { data:userData } = await supabase.auth.getUser()
    const user = userData?.user

    if(!user){
      setLoading(false)
      return
    }

    setCurrentUserId(user.id)

    const { data:companyUser } = await supabase
      .from("company_users")
      .select("company_id")
      .eq("id",user.id)
      .single()

    if(!companyUser){
      console.log("No company found")
      setLoading(false)
      return
    }

    setCompanyId(companyUser.company_id)

    loadRequests(companyUser.company_id)
  }

  /* LOAD REQUESTS */

  const loadRequests = async (companyId:string)=>{

    try{

      setLoading(true)

      const { data,error } = await supabase
        .from("holiday_requests")
        .select(`
          id,
          user_id,
          start_date,
          end_date,
          reason,
          status,
          delete_requested,
          company_users (
            first_name,
            last_name
          )
        `)
        .eq("company_id",companyId)
        .order("created_at",{ ascending:false })

      if(error){
        console.error("Load error:", error)
      }

      setRequests(data || [])

    } catch(err){
      console.error("Crash:", err)
    } finally {
      setLoading(false)
    }

  }

  /* UPDATE STATUS */

  const updateStatus = async (id:string,status:string)=>{

    const { error } = await supabase
      .from("holiday_requests")
      .update({ status })
      .eq("id",id)

    if(error){
      alert(error.message)
      return
    }

    loadRequests(companyId!)
  }

  /* APPROVE DELETE */

  const approveDelete = async (id:string)=>{

    const { error } = await supabase
      .from("holiday_requests")
      .delete()
      .eq("id",id)

    if(error){
      alert(error.message)
      return
    }

    loadRequests(companyId!)
  }

  /* UI */

  if(loading){
    return <p>Loading requests...</p>
  }

  return(

    <div className="page-container">

      <h1 className="page-title">Approve Requests</h1>

      <div className="table-wrapper">

        <table className="admin-table">

          <thead>
            <tr>
              <th>Employee</th>
              <th>Dates</th>
              <th>Reason</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>

            {requests.length === 0 && (
              <tr>
                <td colSpan={5}>
                  No requests found
                </td>
              </tr>
            )}

            {requests.map((r)=>{

              const isOwn = r.user_id === currentUserId

              return(

                <tr key={r.id}>

                  <td className="col-employee">
                    {r.company_users?.first_name} {r.company_users?.last_name}
                    {isOwn && <span className="tag-you">You</span>}
                  </td>

                  <td className="col-dates">
                    {r.start_date} → {r.end_date}
                  </td>

                  <td className="col-reason">
                    {r.reason || "-"}
                  </td>

                  <td className="col-status">
                    <span className={`status-pill ${r.status}`}>
                      {r.status}
                    </span>
                  </td>

                  <td className="col-actions">

                    {!isOwn && r.status === "pending" && (
                      <>
                        <button
                          className="btn-approve"
                          onClick={()=>updateStatus(r.id,"approved")}
                        >
                          Approve
                        </button>

                        <button
                          className="btn-reject"
                          onClick={()=>updateStatus(r.id,"rejected")}
                        >
                          Reject
                        </button>
                      </>
                    )}

                    {isOwn && (
                      <span className="muted">
                        Cannot approve your own
                      </span>
                    )}

                    {r.delete_requested && !isOwn && (
                      <button
                        className="btn-reject"
                        onClick={()=>approveDelete(r.id)}
                      >
                        Approve Delete
                      </button>
                    )}

                  </td>

                </tr>

              )

            })}

          </tbody>

        </table>

      </div>

    </div>

  )

}