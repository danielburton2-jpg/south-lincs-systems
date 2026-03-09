"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/supabase/client";
import { auditLog } from "@/lib/audit/auditLogger";

import "@/styles/forms.css";
import "@/styles/buttons.css";

export default function CreateSuperuserPage() {

  const router = useRouter();

  const [email,setEmail] = useState("");
  const [firstName,setFirstName] = useState("");
  const [lastName,setLastName] = useState("");
  const [password,setPassword] = useState("");
  const [frozen,setFrozen] = useState(false);

  const handleCreate = async (e:React.FormEvent)=>{

    e.preventDefault();

    const { data:userData } =
      await supabase.auth.getUser();

    const currentUser = userData?.user;

    await supabase
      .from("superusers")
      .insert([
        {
          email,
          first_name:firstName,
          last_name:lastName,
          password,
          frozen
        }
      ]);

    await auditLog({
      userId:currentUser?.id ?? null,
      action:"create_superuser",
      description:`Created superuser ${email}`
    });

    router.push("/dev/superusers/view");

  };

  return(

    <div className="page-shell">

      <button
        className="btn-secondary"
        onClick={()=>router.back()}
      >
        Back
      </button>

      <h1>Create Superuser</h1>

      <form
        className="form-container"
        autoComplete="off"
        onSubmit={handleCreate}
      >

        <div className="form-group">

          <label>Email</label>

          <input
            autoComplete="new-email"
            className="form-input"
            value={email}
            onChange={(e)=>setEmail(e.target.value)}
          />

        </div>

        <div className="form-group">

          <label>First Name</label>

          <input
            autoComplete="off"
            className="form-input"
            value={firstName}
            onChange={(e)=>setFirstName(e.target.value)}
          />

        </div>

        <div className="form-group">

          <label>Last Name</label>

          <input
            autoComplete="off"
            className="form-input"
            value={lastName}
            onChange={(e)=>setLastName(e.target.value)}
          />

        </div>

        <div className="form-group">

          <label>Password</label>

          <input
            type="password"
            autoComplete="new-password"
            className="form-input"
            value={password}
            onChange={(e)=>setPassword(e.target.value)}
          />

        </div>

        <div className="form-checkbox">

          <label>Frozen</label>

          <input
            type="checkbox"
            checked={frozen}
            onChange={(e)=>setFrozen(e.target.checked)}
          />

        </div>

        <button
          className="btn-primary"
          type="submit"
        >
          Create Superuser
        </button>

      </form>

    </div>

  );

}