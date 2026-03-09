"use client";

import { useRouter } from "next/navigation";
import { supabase } from "@/supabase/client";

export default function Dashboard() {

  const router = useRouter();

  const handleLogout = async () => {

    await supabase.auth.signOut();

    router.replace("/login");

  };

  return (

    <div>

      <h1>Dashboard</h1>

      <button onClick={handleLogout}>
        Logout
      </button>

    </div>

  );

}