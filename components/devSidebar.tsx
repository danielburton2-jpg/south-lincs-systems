"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/supabase/client";

export default function DevSidebar() {

  const router = useRouter();

  const handleLogout = async () => {

    const { error } = await supabase.auth.signOut();

    if (!error) {

      // force session clear and redirect
      window.location.href = "/login";

    }

  };

  return (

    <div className="dev-sidebar">

      <h2>South Lincs Systems</h2>

      <nav>

        <Link href="/dev/dashboard">Dashboard</Link>
        <Link href="/dev/superusers">Superusers</Link>
        <Link href="/dev/companies">Companies</Link>
        <Link href="/dev/audit">Audit Logs</Link>

      </nav>

      <button
        onClick={handleLogout}
        className="logout-button"
      >
        Logout
      </button>

    </div>

  );

}