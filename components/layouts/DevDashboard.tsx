"use client"

import { useState } from "react"

import DevSidebar from "@/components/sidebars/DevSidebar"

import CreateCompany from "@/components/modules/companies/CreateCompany"
import ViewCompanies from "@/components/modules/companies/ViewCompanies"
import ViewCompany from "@/components/modules/companies/ViewCompany"
import EditCompany from "@/components/modules/companies/EditCompany"

import CreateCompanyUser from "@/components/modules/companies/CreateCompanyUser"
import ViewCompanyUsers from "@/components/modules/companies/ViewCompanyUsers"
import EditCompanyUser from "@/components/modules/companies/EditCompanyUser"

import "@/styles/layout.css"

export default function DevDashboard(){

  const [page,setPage] = useState("dashboard")

  const [viewCompany,setViewCompany] = useState<any>(null)
  const [editCompany,setEditCompany] = useState<any>(null)

  const [createUserCompany,setCreateUserCompany] = useState<any>(null)

  const [viewCompanyUsers,setViewCompanyUsers] = useState<any>(null)
  const [editUser,setEditUser] = useState<any>(null)

  return(

    <div className="dev-layout">

      <DevSidebar setPage={setPage} />

      <div className="dev-content">

        {/* DASHBOARD */}

        {page === "dashboard" && (

          <div>

            <h1>Dev Dashboard</h1>

          </div>

        )}

        {/* CREATE COMPANY */}

        {page === "create-company" && (

          <CreateCompany
            close={()=>setPage("dashboard")}
          />

        )}

        {/* VIEW COMPANIES */}

        {page === "view-companies" && !viewCompany && (

          <ViewCompanies
            openCompany={setViewCompany}
          />

        )}

        {/* VIEW COMPANY */}

        {viewCompany && !editCompany && !createUserCompany && !viewCompanyUsers && (

          <ViewCompany
            company={viewCompany}
            close={()=>setViewCompany(null)}
            openEdit={setEditCompany}
            openCreateUser={setCreateUserCompany}
            openViewUsers={setViewCompanyUsers}
          />

        )}

        {/* EDIT COMPANY */}

        {editCompany && (

          <EditCompany
            company={editCompany}
            close={()=>setEditCompany(null)}
          />

        )}

        {/* CREATE COMPANY USER */}

        {createUserCompany && (

          <CreateCompanyUser
            company={createUserCompany}
            close={()=>setCreateUserCompany(null)}
          />

        )}

        {/* VIEW COMPANY USERS */}

        {viewCompanyUsers && !editUser && (

          <ViewCompanyUsers
            company={viewCompanyUsers}
            close={()=>setViewCompanyUsers(null)}
            openEditUser={setEditUser}
          />

        )}

        {/* EDIT USER */}

        {editUser && (

          <EditCompanyUser
            user={editUser}
            close={()=>setEditUser(null)}
          />

        )}

      </div>

    </div>

  )

}