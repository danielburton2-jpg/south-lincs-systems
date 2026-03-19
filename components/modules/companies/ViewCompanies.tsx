"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/supabase/client"

import "@/styles/tables.css"

export default function ViewCompanies({ openCompany }: any){

  const [companies,setCompanies] = useState<any[]>([])
  const [loading,setLoading] = useState(true)

  useEffect(()=>{

    const loadCompanies = async ()=>{

      const { data } = await supabase
        .from("companies")
        .select("*")
        .order("name")

      if(data){
        setCompanies(data)
      }

      setLoading(false)

    }

    loadCompanies()

  },[])

  if(loading){
    return <p>Loading companies...</p>
  }

  return(

    <div>

      <h1>Companies</h1>

      <table className="admin-table">

        <thead>

          <tr>
            <th>Name</th>
            <th>Active</th>
            <th>Until / Override</th>
          </tr>

        </thead>

        <tbody>

          {companies.map((company)=>{

            const until =
              company.override
                ? "Overridden"
                : company.subscription_end

            return(

              <tr
                key={company.id}
                className="click-row"
                onClick={()=>openCompany(company)}
              >

                <td>{company.name}</td>

                <td>
                  {company.active ? "Active" : "Inactive"}
                </td>

                <td>{until}</td>

              </tr>

            )

          })}

        </tbody>

      </table>

    </div>

  )

}