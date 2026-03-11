"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/supabase/client"
import { auditLog } from "@/lib/audit/auditLogger"

import "@/styles/forms.css"

export default function AuditSearch({ setAuditResults }: any){

  const [users,setUsers] = useState<any[]>([])
  const [actions,setActions] = useState<any[]>([])
  const [tables,setTables] = useState<any[]>([])
  const [companies,setCompanies] = useState<any[]>([])

  const [user,setUser] = useState("all")
  const [action,setAction] = useState("all")
  const [table,setTable] = useState("all")
  const [company,setCompany] = useState("all")

  /* LOAD FILTER VALUES */

  useEffect(()=>{

    const loadFilters = async ()=>{

      /* LOAD USERS */

      const { data:userLogs } = await supabase
        .from("audit_logs")
        .select("user_id")

      if(userLogs){

        const userIds = [...new Set(userLogs.map((u:any)=>u.user_id))]

        const { data:userData } = await supabase
          .from("superusers")
          .select("id,first_name,last_name")
          .in("id",userIds)

        if(userData){

          setUsers(userData)

        }

      }

      /* LOAD ACTIONS */

      const { data:actionData } = await supabase
        .from("audit_logs")
        .select("action")

      if(actionData){

        const uniqueActions =
          [...new Set(actionData.map((a:any)=>a.action))]

        setActions(uniqueActions)

      }

      /* LOAD TABLES */

      const { data:tableData } = await supabase
        .from("audit_logs")
        .select("table_name")

      if(tableData){

        const uniqueTables =
          [...new Set(tableData.map((t:any)=>t.table_name))]

        setTables(uniqueTables)

      }

      /* LOAD COMPANIES */

      const { data:companyData } = await supabase
        .from("companies")
        .select("id,name")
        .order("name")

      if(companyData){

        setCompanies(companyData)

      }

    }

    loadFilters()

  },[])

  /* SEARCH */

  const handleSearch = async ()=>{

    let query = supabase
      .from("audit_logs")
      .select("*")
      .order("created_at",{ ascending:false })

    if(user !== "all"){

      query = query.eq("user_id",user)

    }

    if(action !== "all"){

      query = query.eq("action",action)

    }

    if(table !== "all"){

      query = query.eq("table_name",table)

    }

    if(company !== "all"){

      query = query.eq("company_id",company)

    }

    const { data } = await query

    if(data){

      setAuditResults(data)

    }

    await auditLog({

      action:"SEARCH",
      table:"audit_logs",
      description:"Audit search executed"

    })

  }

  return(

    <div className="form-container">

      <h1>Audit Search</h1>

      <div className="stack-form">

        {/* USER */}

        <label>User</label>

        <select
          value={user}
          onChange={(e)=>setUser(e.target.value)}
        >

          <option value="all">
            All Users
          </option>

          {users.map((u:any)=>(
            <option key={u.id} value={u.id}>
              {u.first_name} {u.last_name}
            </option>
          ))}

        </select>

        {/* ACTION */}

        <label>Action</label>

        <select
          value={action}
          onChange={(e)=>setAction(e.target.value)}
        >

          <option value="all">
            All
          </option>

          {actions.map((a:any,index:number)=>(
            <option key={index} value={a}>
              {a}
            </option>
          ))}

        </select>

        {/* TABLE */}

        <label>Table</label>

        <select
          value={table}
          onChange={(e)=>setTable(e.target.value)}
        >

          <option value="all">
            All
          </option>

          {tables.map((t:any,index:number)=>(
            <option key={index} value={t}>
              {t}
            </option>
          ))}

        </select>

        {/* COMPANY */}

        <label>Company</label>

        <select
          value={company}
          onChange={(e)=>setCompany(e.target.value)}
        >

          <option value="all">
            All Companies
          </option>

          {companies.map((c:any)=>(
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}

        </select>

        <button
          className="primary-button"
          onClick={handleSearch}
        >
          Search
        </button>

      </div>

    </div>

  )

}