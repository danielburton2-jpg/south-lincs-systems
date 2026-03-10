"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/supabase/client";
import { auditLog } from "@/lib/audit/auditLogger";

import "@/styles/tables.css";

type Superuser = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  frozen: boolean | null;
};

export default function ViewSuperusers(){

  const router = useRouter();

  const [users,setUsers] = useState<Superuser[]>([]);
  const [loading,setLoading] = useState(true);



  useEffect(()=>{
    loadUsers();
  },[]);



  async function loadUsers(){

    const { data:userData } = await supabase.auth.getUser();

    const { data,error } = await supabase
      .from("superusers")
      .select("*")
      .is("deleted_at",null)
      .order("first_name",{ ascending:true });

    if(error){
      console.error(error);
      return;
    }

    setUsers(data || []);
    setLoading(false);



    if(userData?.user){
      await auditLog({
        userId: userData.user.id,
        action: "view_superusers",
        description: "Superuser viewed superusers list"
      });
    }

  }



  if(loading){
    return <div>Loading superusers...</div>;
  }



  return(

    <div>

      <h1>Superusers</h1>

      <div className="table-wrapper">

        <table className="data-table">

          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>

            {users.map((u)=>{

              const name = `${u.first_name || ""} ${u.last_name || ""}`.trim();

              return(

                <tr
                  key={u.id}
                  className="clickable-row"
                  onClick={()=>router.push(`/dev/superusers/edit/${u.id}`)}
                >

                  <td>{name || "No Name"}</td>

                  <td>{u.email}</td>

                  <td>{u.frozen ? "Frozen" : "Active"}</td>

                </tr>

              );

            })}

          </tbody>

        </table>

      </div>

    </div>

  );

}