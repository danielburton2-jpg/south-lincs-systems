"use client";

import { useState } from "react";
import { useRouter, usePathname } from "next/navigation";

import "@/styles/dev-sidebar.css";

export default function DevSidebar(){

  const router = useRouter();
  const pathname = usePathname();

  const [superusersOpen,setSuperusersOpen] = useState(
    pathname.startsWith("/dev/superusers")
  );

  const [companiesOpen,setCompaniesOpen] = useState(
    pathname.startsWith("/dev/companies")
  );



  const navigate = (path:string)=>{
    router.push(path);
  };



  return(

    <div className="dev-sidebar">

      <div className="dev-sidebar-header">

        <div className="dev-logo">
          SL
        </div>

        <div className="dev-title">
          South Lincs
          <div className="dev-sub">
            Dev System
          </div>
        </div>

        <button
          className="logout-small"
          onClick={()=>router.push("/login")}
        >
          Logout
        </button>

      </div>



      <div className="dev-sidebar-menu">

        <div
          className={`sidebar-item ${pathname === "/dev/dashboard" ? "active":""}`}
          onClick={()=>navigate("/dev/dashboard")}
        >
          Dashboard
        </div>



        <div
          className="sidebar-item"
          onClick={()=>setSuperusersOpen(!superusersOpen)}
        >
          Superusers
        </div>

        {superusersOpen && (

          <div className="sidebar-submenu">

            <div
              className={`sidebar-subitem ${pathname === "/dev/superusers/view" ? "active":""}`}
              onClick={()=>navigate("/dev/superusers/view")}
            >
              View Superusers
            </div>

            <div
              className={`sidebar-subitem ${pathname === "/dev/superusers/create" ? "active":""}`}
              onClick={()=>navigate("/dev/superusers/create")}
            >
              Create Superuser
            </div>

          </div>

        )}



        <div
          className="sidebar-item"
          onClick={()=>setCompaniesOpen(!companiesOpen)}
        >
          Companies
        </div>

        {companiesOpen && (

          <div className="sidebar-submenu">

            <div
              className={`sidebar-subitem ${pathname === "/dev/companies/view" ? "active":""}`}
              onClick={()=>navigate("/dev/companies/view")}
            >
              View Companies
            </div>

            <div
              className={`sidebar-subitem ${pathname === "/dev/companies/create" ? "active":""}`}
              onClick={()=>navigate("/dev/companies/create")}
            >
              Create Company
            </div>

          </div>

        )}

      </div>

    </div>

  );

}