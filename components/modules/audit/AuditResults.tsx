"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/supabase/client"

import "@/styles/audit.css"

export default function AuditResults({ results, setShowResults }: any){

  const [logs,setLogs] = useState<any[]>([])
  const [users,setUsers] = useState<any>({})
  const [companies,setCompanies] = useState<any>({})

  useEffect(()=>{

    const loadData = async ()=>{

      setLogs(results)

      /* LOAD USERS */

      const userIds =
        [...new Set(results.map((r:any)=>r.user_id).filter(Boolean))]

      if(userIds.length){

        const { data:userData } = await supabase
          .from("superusers")
          .select("id,first_name,last_name")
          .in("id",userIds)

        if(userData){

          const map:any = {}

          userData.forEach((u:any)=>{

            map[u.id] = `${u.first_name} ${u.last_name}`

          })

          setUsers(map)

        }

      }

      /* LOAD COMPANIES */

      const companyIds =
        [...new Set(results.map((r:any)=>r.company_id).filter(Boolean))]

      if(companyIds.length){

        const { data:companyData } = await supabase
          .from("companies")
          .select("id,name")
          .in("id",companyIds)

        if(companyData){

          const map:any = {}

          companyData.forEach((c:any)=>{

            map[c.id] = c.name

          })

          setCompanies(map)

        }

      }

    }

    loadData()

  },[results])

  /* DOWNLOAD CSV */

  const downloadCSV = ()=>{

    let csv = "Time,User,Company,Action,Description\n"

    logs.forEach((log:any)=>{

      const user = users[log.user_id] || "Unknown"
      const company = companies[log.company_id] || ""

      csv += `"${log.created_at}","${user}","${company}","${log.action}","${log.description}"\n`

    })

    const blob = new Blob([csv],{ type:"text/csv" })
    const url = window.URL.createObjectURL(blob)

    const a = document.createElement("a")

    a.href = url
    a.download = "audit_logs.csv"
    a.click()

  }

  const printPage = ()=>{

    window.print()

  }

  return(

    <div className="audit-container">

      <div className="audit-buttons no-print">

        <button onClick={downloadCSV}>
          Download
        </button>

        <button onClick={printPage}>
          Print
        </button>

        <button onClick={setShowResults}>
          Close
        </button>

      </div>

      <h2 className="audit-title">
        South Lincs Systems
      </h2>

      <p className="audit-subtitle">
        Audit Report — Generated {new Date().toLocaleString()}
      </p>

      <table className="audit-table">

        <thead>

          <tr>
            <th>Time</th>
            <th>User</th>
            <th>Company</th>
            <th>Action</th>
            <th>Description</th>
          </tr>

        </thead>

        <tbody>

          {logs.map((log:any)=>{

            const user =
              users[log.user_id] || "Unknown"

            const company =
              companies[log.company_id] || ""

            return(

              <tr key={log.id}>

                <td>
                  {new Date(log.created_at).toLocaleString()}
                </td>

                <td>{user}</td>

                <td>{company}</td>

                <td>{log.action}</td>

                <td>{log.description}</td>

              </tr>

            )

          })}

        </tbody>

      </table>

    </div>

  )

}