"use client"

import { useState, useEffect } from "react"
import { supabase } from "@/supabase/client"

import DevSidebar from "@/components/sidebars/DevSidebar"

import CreateSuperuser from "@/components/modules/superusers/CreateSuperuser"
import ViewSuperusers from "@/components/modules/superusers/ViewSuperusers"
import EditSuperuser from "@/components/modules/superusers/EditSuperuser"

import CreateCompany from "@/components/modules/companies/CreateCompany"
import ViewCompanies from "@/components/modules/companies/ViewCompanies"
import ViewCompany from "@/components/modules/companies/ViewCompany"
import EditCompany from "@/components/modules/companies/EditCompany"
import CreateCompanyUser from "@/components/modules/companies/CreateCompanyUser"
<<<<<<< HEAD
import ViewCompanyUsers from "@/components/modules/companies/ViewCompanyUsers"

import EditCompanyUser from "@/components/modules/companies/EditCompanyUser"
=======
>>>>>>> d80cabaf8de6025d187f0b7eccf894f4bdbf9f43

import "@/styles/layout.css"

export default function DevDashboard(){

<<<<<<< HEAD
  const [page,setPage] = useState("dashboard")

  const [userName,setUserName] = useState("")

  const [editUser,setEditUser] = useState<any>(null)

  const [selectedCompany,setSelectedCompany] = useState<any>(null)
  const [editCompany,setEditCompany] = useState<any>(null)
  const [createUserCompany,setCreateUserCompany] = useState<any>(null)

  const [viewUsersCompany,setViewUsersCompany] = useState<any>(null)

  /* LOAD CURRENT USER */

  useEffect(()=>{

    const loadUser = async ()=>{

      const { data:sessionData } =
        await supabase.auth.getSession()

      const userId =
        sessionData?.session?.user?.id

      if(!userId) return

      const { data:user } = await supabase
        .from("superusers")
        .select("first_name,last_name")
        .eq("id",userId)
        .single()

      if(user){
        setUserName(`${user.first_name} ${user.last_name}`)
      }

    }

    loadUser()

  },[])

  return(

    <div className="dev-layout">

      <DevSidebar setPage={setPage}/>

      <div className="dev-content">

        {/* DASHBOARD */}

        {page === "dashboard" && (

          <div>
            <h1>Welcome {userName}</h1>
            <p>South Lincs Systems Dev Environment</p>
          </div>

        )}

        {/* CREATE SUPERUSER */}

        {page === "create-superuser" && (

          <CreateSuperuser
            close={()=>setPage("dashboard")}
          />

        )}

        {/* VIEW SUPERUSERS */}

        {page === "view-superusers" && !editUser && (

          <ViewSuperusers
            openEdit={setEditUser}
          />

        )}

        {/* EDIT SUPERUSER */}

        {page === "view-superusers" && editUser && (

          <EditSuperuser
            user={editUser}
            close={()=>setEditUser(null)}
          />

        )}

        {/* CREATE COMPANY */}

        {page === "create-company" && (

          <CreateCompany
            close={()=>setPage("view-companies")}
          />

        )}

        {/* VIEW COMPANIES */}

        {page === "view-companies" && !selectedCompany && (

          <ViewCompanies
            openCompany={setSelectedCompany}
          />

        )}

        {/* VIEW COMPANY PANEL */}

        {page === "view-companies" && selectedCompany && !editCompany && !createUserCompany && !viewUsersCompany && (

          <ViewCompany
            company={selectedCompany}
            close={()=>setSelectedCompany(null)}
            openEdit={setEditCompany}
            openCreateUser={setCreateUserCompany}
            openViewUsers={(company:any)=>{
              setViewUsersCompany(company)
              setPage("view-company-users")
            }}
          />

        )}

        {/* EDIT COMPANY */}

        {page === "view-companies" && editCompany && (

          <EditCompany
            company={editCompany}
            close={()=>setEditCompany(null)}
          />

        )}

        {/* CREATE COMPANY USER */}

        {page === "view-companies" && createUserCompany && (

          <CreateCompanyUser
            companyId={createUserCompany.id}
            close={()=>setCreateUserCompany(null)}
          />

        )}

        {/* VIEW COMPANY USERS */}

        {page === "view-company-users" && viewUsersCompany && !editUser && (

          <ViewCompanyUsers
            company={viewUsersCompany}
            close={()=>{
              setViewUsersCompany(null)
              setPage("view-companies")
            }}
            openEditUser={(user:any)=>{
              console.log("EDIT CLICKED:", user)
              setEditUser(user)
              setPage("edit-company-user")   // 🔥 THIS IS THE FIX
            }}
          />

        )}

        {/* EDIT COMPANY USER */}

        {page === "edit-company-user" && editUser && (

          <EditCompanyUser
            user={editUser}
            close={()=>{
              setEditUser(null)
              setPage("view-company-users")
            }}
          />

        )}

      </div>

    </div>

  )
=======
const [page,setPage] = useState("dashboard")

const [userName,setUserName] = useState("")

const [editUser,setEditUser] = useState<any>(null)

const [selectedCompany,setSelectedCompany] = useState<any>(null)
const [editCompany,setEditCompany] = useState<any>(null)
const [createUserCompany,setCreateUserCompany] = useState<any>(null)

/* LOAD CURRENT USER */

useEffect(()=>{

const loadUser = async ()=>{

const { data:sessionData } =
await supabase.auth.getSession()

const userId =
sessionData?.session?.user?.id

if(!userId) return

const { data:user } = await supabase
.from("superusers")
.select("first_name,last_name")
.eq("id",userId)
.single()

if(user){

setUserName(
`${user.first_name} ${user.last_name}`
)

}

}

loadUser()

},[])

return(

<div className="dev-layout">

<DevSidebar setPage={setPage}/>

<div className="dev-content">

{/* DASHBOARD */}

{page === "dashboard" && (

<div>

<h1>
Welcome {userName}
</h1>

<p>
South Lincs Systems Dev Environment
</p>

</div>

)}

{/* CREATE SUPERUSER */}

{page === "create-superuser" && (

<CreateSuperuser
close={()=>setPage("dashboard")}
/>

)}

{/* VIEW SUPERUSERS */}

{page === "view-superusers" && !editUser && (

<ViewSuperusers
openEdit={setEditUser}
/>

)}

{/* EDIT SUPERUSER */}

{page === "view-superusers" && editUser && (

<EditSuperuser
user={editUser}
close={()=>setEditUser(null)}
/>

)}

{/* CREATE COMPANY */}

{page === "create-company" && (

<CreateCompany
close={()=>setPage("view-companies")}
/>

)}

{/* VIEW COMPANIES */}

{page === "view-companies" && !selectedCompany && (

<ViewCompanies
openCompany={setSelectedCompany}
/>

)}

{/* VIEW COMPANY PANEL */}

{page === "view-companies" && selectedCompany && !editCompany && !createUserCompany && (

<ViewCompany
company={selectedCompany}
close={()=>setSelectedCompany(null)}
openEdit={setEditCompany}
openCreateUser={setCreateUserCompany}
openViewUsers={()=>{}}
/>

)}

{/* EDIT COMPANY */}

{page === "view-companies" && editCompany && (

<EditCompany
company={editCompany}
close={()=>setEditCompany(null)}
/>

)}

{/* CREATE COMPANY USER */}

{page === "view-companies" && createUserCompany && (

<CreateCompanyUser
companyId={createUserCompany.id}
close={()=>setCreateUserCompany(null)}
/>

)}

</div>

</div>

)
>>>>>>> d80cabaf8de6025d187f0b7eccf894f4bdbf9f43

}