"use client"

import { useState,useEffect } from "react"
import { supabase } from "@/supabase/client"
import { auditLog } from "@/lib/audit/auditLogger"

import "@/styles/table.css"

export default function ApproveRequests({ company }: any){

  const [requests,setRequests] = useState<any[]>([])

  useEffect(()=>{

    loadRequests()

  },[])

  const loadRequests = async ()=>{

    const { data } = await supabase
      .from("holiday_requests")
      .select("*")
      .eq("company_id",company.id)
      .eq("status","pending")
      .order("created_at",{ ascending:false })

    if(data){
      setRequests(data)
    }

  }

  const approveRequest = async(req:any)=>{

    const { error } = await supabase
      .from("holiday_requests")
      .update({

        status:"approved"

      })
      .eq("id",req.id)

    if(error){
      alert(error.message)
      return
    }

    /* AUDIT */

    await auditLog({

      action: "approve_holiday",
      table: "holiday_requests",
      description: "Approved holiday request",
      companyId: req.company_id,
      targetId: req.id

    })

    loadRequests()

  }

  const rejectRequest = async(req:any)=>{

    const { error } = await supabase
      .from("holiday_requests")
      .update({

        status:"rejected"

      })
      .eq("id",req.id)

    if(error){
      alert(error.message)
      return
    }

    await auditLog({

      action: "reject_holiday",
      table: "holiday_requests",
      description: "Rejected holiday request",
      companyId: req.company_id,
      targetId: req.id

    })

    loadRequests()

  }

  return(

    <div className="table-container">

      <h1>Holiday Requests</h1>

      <table className="table">

        <thead>

          <tr>
            <th>Employee</th>
            <th>Start</th>
            <th>End</th>
            <th>Reason</th>
            <th>Actions</th>
          </tr>

        </thead>

        <tbody>

          {requests.map(req=>(

            <tr key={req.id}>

              <td>{req.user_id}</td>
              <td>{req.start_date}</td>
              <td>{req.end_date}</td>
              <td>{req.reason}</td>

              <td>

                <button
                  onClick={()=>approveRequest(req)}
                >
                  Approve
                </button>

                <button
                  onClick={()=>rejectRequest(req)}
                >
                  Reject
                </button>

              </td>

            </tr>

          ))}

        </tbody>

      </table>

    </div>

  )

}