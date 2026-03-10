"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/supabase/client";
import "@/styles/dev-sidebar.css";

export default function DevSidebar() {

  const pathname = usePathname();

  const handleLogout = async () => {

    await supabase.auth.signOut();

    window.location.href = "/login";

  };

  const navItems = [
    { name: "Dashboard", path: "/dev/dashboard" },
    { name: "Superusers", path: "/dev/superusers" },
    { name: "Companies", path: "/dev/companies" },
    { name: "Features", path: "/dev/features" },
    { name: "Audit Logs", path: "/dev/audit" },
    
  ];

  return (

    <aside className="dev-sidebar">

      <div className="dev-sidebar-header">

        <div className="sidebar-logo">
          SL
        </div>

        <div className="sidebar-title">
          <h2>South Lincs</h2>
          <p>Dev System</p>
        </div>

      </div>

      <nav className="dev-sidebar-nav">

        {navItems.map((item) => (

          <Link
            key={item.path}
            href={item.path}
            className={
              pathname === item.path
                ? "sidebar-link active"
                : "sidebar-link"
            }
          >
            {item.name}
          </Link>

        ))}

      </nav>

      <div className="dev-sidebar-footer">

        <button
          onClick={handleLogout}
          className="logout-button"
        >
          Logout
        </button>

      </div>

    </aside>

  );

}