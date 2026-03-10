"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/supabase/client";
import { auditLog } from "@/lib/audit/auditLogger";

import DevSidebar from "@/components/devSidebar";

import "@/styles/dev-layout.css";

export default function DevLayout({
  children,
}: {
  children: React.ReactNode;
}) {

  const router = useRouter();
  const [loading,setLoading] = useState(true);

  useEffect(()=>{
    checkAccess();
  },[]);



  async function checkAccess(){

    const { data:userData } = await supabase.auth.getUser();

    if(!userData?.user){
      router.push("/login");
      return;
    }

    const user = userData.user;



    const { data:superuser } = await supabase
      .from("superusers")
      .select("*")
      .eq("email", user.email)
      .is("deleted_at", null)
      .maybeSingle();



    if(!superuser || superuser.frozen){
      router.push("/login");
      return;
    }



    await auditLog({
      userId: user.id,
      action: "dev_page_view",
      description: "Superuser accessed dev panel"
    });



    setLoading(false);

  }



  if(loading){
    return <div style={{padding:"40px"}}>Loading...</div>;
  }



  return(

    <div className="dev-layout">

      <DevSidebar />

      <div className="dev-content">
        {children}
      </div>

    </div>

  );

}