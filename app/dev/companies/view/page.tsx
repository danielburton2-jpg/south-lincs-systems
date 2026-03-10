"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/supabase/client";
import { auditLog } from "@/lib/audit/auditLogger";

import "@/styles/tables.css";

type Company = {
  id: string;
  name: string;
  contact_email: string;
  contact_phone: string;
  subscription: string;
  active: boolean;
};

export default function ViewCompanies(){

  const router = useRouter();

  const [companies,setCompanies] = useState<Company[]>([]);
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

    // CHECK SUPERUSER ACCESS

    const { data:superuser } = await supabase
      .from("superusers")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if(!superuser){
      router.push("/dev/dashboard");
      return;
    }

    // AUDIT LOG — VIEW COMPANIES

    await auditLog({
      userId: user.id,
      action: "view_companies",
      description: "Superuser viewed companies list"
    });

    loadCompanies();

  }



  async function loadCompanies(){

    const { data,error } = await supabase
      .from("companies")
      .select("*")
      .order("created_at",{ ascending:false });

    if(error){
      console.error(error);
      return;
    }

    setCompanies(data || []);
    setLoading(false);

  }



  if(loading){
    return <div>Loading companies...</div>;
  }



  return(

    <div>

      <h1>Companies</h1>

      <div className="table-wrapper">

        <table className="data-table">

          <thead>

            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Subscription</th>
              <th>Status</th>
            </tr>

          </thead>

          <tbody>

            {companies.map(company => (

              <tr key={company.id}>

                <td>{company.name}</td>
                <td>{company.contact_email}</td>
                <td>{company.contact_phone}</td>
                <td>{company.subscription}</td>

                <td>
                  {company.active ? "Active" : "Inactive"}
                </td>

              </tr>

            ))}

          </tbody>

        </table>

      </div>

    </div>

  );

}