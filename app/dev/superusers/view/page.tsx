"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/supabase/client";

import "@/styles/table.css";
import "@/styles/button.css";

export default function ViewSuperusersPage() {
  const router = useRouter();
  const [superusers, setSuperusers] = useState<any[]>([]);

  useEffect(() => {
    const loadSuperusers = async () => {
      const { data } = await supabase.from("superusers").select("*");

      if (data) setSuperusers(data);
    };

    loadSuperusers();
  }, []);

  return (
    <div>
      <button className="btn-secondary" onClick={() => router.back()}>
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
          {superusers.map((user) => (
            <tr key={user.id}>
              <td>
                <button
                  className="table-link"
                  onClick={() =>
                    router.push(`/dev/superusers/edit/${user.id}`)
                  }
                >
                  {user.name}
                </button>
              </td>

              <td>{user.email}</td>

              <td>{user.frozen ? "Frozen" : "Active"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}