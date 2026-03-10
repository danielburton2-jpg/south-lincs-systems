"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/supabase/client"
import { auditLog } from "@/lib/audit/auditLogger"

import "@/styles/modules.css"

export default function AuditSearch({ setAuditResults }: any) {

  const [action,setAction] = useState("")
  const [tableName,setTableName] = useState("")
  const [userId,setUserId] = useState("")
  const [users,setUsers] = useState<any[]>([])
  const [loading,setLoading] = useState(false)

  /* LOAD SUPERUSERS FOR DROPDOWN */

  useEffect(()=>{

    const loadUsers = async ()=>{

      const { data } = await supabase
        .from("superusers")
        .select("id,first_name,last_name")
        .order("first_name")

      if(data){
        setUsers(data)
      }

    }

    loadUsers()

  },[])

  const handleSearch = async () => {

    setLoading(true)

    let query = supabase
      .from("audit_logs")
      .select("*")

    if(action){
      query = query.eq("action",action)
    }

    if(tableName){
      query = query.eq("table_name",tableName)
    }

    if(userId){
      query = query.eq("user_id",userId)
    }

    const { data:logs,error } = await query
      .order("created_at",{ascending:false})

    if(error){
      console.log("Audit search error:",error)
      setLoading(false)
      return
    }

    const userMap:any = {}

    users.forEach((u:any)=>{
      userMap[u.id] = `${u.first_name} ${u.last_name}`
    })

    const results = logs?.map((log:any)=>({

      ...log,

      user_name: userMap[log.user_id] || "System"

    }))

    const { data:sessionData } = await supabase.auth.getSession()

    const currentUser = sessionData?.session?.user?.id

    if(currentUser){
      await auditLog(
        currentUser,
        "audit_search",
        "Audit search executed"
      )
    }

    setAuditResults(results)

    setLoading(false)

  }

  return (

    <div className="module-container">

      <h1 className="module-title">
        Audit Search
      </h1>

      {/* USER FILTER */}

      <div className="filter-group">

        <label>User</label>

        <select
          value={userId}
          onChange={(e)=>setUserId(e.target.value)}
        >

          <option value="">All Users</option>

          {users.map((user)=>(
            <option
              key={user.id}
              value={user.id}
            >
              {user.first_name} {user.last_name}
            </option>
          ))}

        </select>

      </div>

      {/* ACTION FILTER */}

      <div className="filter-group">

        <label>Action</label>

        <select
          value={action}
          onChange={(e)=>setAction(e.target.value)}
        >

          <option value="">All</option>
          <option value="login">Login</option>
          <option value="audit_search">Audit Search</option>

        </select>

      </div>

      {/* TABLE FILTER */}

      <div className="filter-group">

        <label>Table</label>

        <select
          value={tableName}
          onChange={(e)=>setTableName(e.target.value)}
        >

          <option value="">All</option>
          <option value="superusers">Superusers</option>

        </select>

      </div>

      <button
        className="search-button"
        onClick={handleSearch}
        disabled={loading}
      >

        {loading ? "Searching..." : "Search"}

      </button>

    </div>

  )

}