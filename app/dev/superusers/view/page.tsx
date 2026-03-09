"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/supabase/client";

import "@/styles/tables.css";
import "@/styles/buttons.css";

type Superuser = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  frozen: boolean | null;
  deleted_at: string | null;
};

export default function ViewSuperusersPage() {

  const router = useRouter();

  const [superusers,setSuperusers] =
    useState<Superuser[]>([]);

  const [loading,setLoading] =
    useState(true);

  useEffect(()=>{

    const loadSuperusers = async()=>{

      const { data,error } =
        await supabase
          .from("superusers")
          .select("*")
          .is("deleted_at",null)
          .order("created_at",{ ascending:false });

      if(error){
        console.error("Error loading superusers:",error);
      }

      if(data){
        setSuperusers(data);
      }

      setLoading(false);

    };

    loadSuperusers();

  },[]);

  const getName = (user:Superuser) => {

    const first = user.first_name ?? "";
    const last = user.last_name ?? "";

    const name = `${first} ${last}`.trim();

    if(name.length > 0){
      return name;
    }

    return user.email;

  };

  return (

    <div className="page-shell">

      <button
        className="btn-secondary"
        onClick={()=>router.back()}
      >
        Back
      </button>

      <h1>Superusers</h1>

      <table className="data-table">

        <thead>

          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Status</th>
          </tr>

        </thead>

        <tbody>

          {loading ? (

            <tr>
              <td colSpan={3}>Loading...</td>
            </tr>

          ) : superusers.length === 0 ? (

            <tr>
              <td colSpan={3}>No superusers found</td>
            </tr>

          ) : (

            superusers.map((user)=>{

              return(

                <tr
                  key={user.id}
                  className="clickable-row"
                  onClick={()=>
                    router.push(
                      `/dev/superusers/edit/${user.id}`
                    )
                  }
                >

                  <td>{getName(user)}</td>

                  <td>{user.email}</td>

                  <td>
                    {user.frozen ? "Frozen" : "Active"}
                  </td>

                </tr>

              );

            })

          )}

        </tbody>

      </table>

    </div>

  );

}