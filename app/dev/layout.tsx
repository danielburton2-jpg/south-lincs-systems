"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/supabase/client";

import DevSidebar from "@/components/devSidebar";

import "@/styles/dev-layout.css";
import "@/styles/dev-sidebar.css";

export default function DevLayout({
  children,
}: {
  children: React.ReactNode;
}) {

  const router = useRouter();
  const [loading,setLoading] = useState(true);

  useEffect(() => {

    const checkSession = async () => {

      const { data } = await supabase.auth.getSession();

      if (!data.session) {
        router.replace("/login");
        return;
      }

      setLoading(false);

    };

    checkSession();

  }, [router]);

  if (loading) {
    return <div style={{padding:"40px"}}>Checking login...</div>;
  }

  return (

    <div className="dev-layout">

      <DevSidebar />

      <div className="dev-content">
        {children}
      </div>

    </div>

  );
}