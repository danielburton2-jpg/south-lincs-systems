"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/supabase/client";
import { auditLog } from "@/lib/audit/auditLogger";

import "@/styles/forms.css";

export default function CreateSuperuser(){

  const router = useRouter();

  const [firstName,setFirstName] = useState("");
  const [lastName,setLastName] = useState("");
  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");

  const [loading,setLoading] = useState(false);
  const [error,setError] = useState("");



  async function handleSubmit(e:React.FormEvent){

    e.preventDefault();

    setLoading(true);
    setError("");

    const { data:userData } = await supabase.auth.getUser();

    if(!userData?.user){
      router.push("/login");
      return;
    }



    const { error:insertError } = await supabase
      .from("superusers")
      .insert({
        first_name:firstName,
        last_name:lastName,
        email:email,
        password:password,
        frozen:false
      });



    if(insertError){
      setError(insertError.message);
      setLoading(false);
      return;
    }



    await auditLog({
      userId:userData.user.id,
      action:"create_superuser",
      description:`Created superuser ${email}`
    });



    router.push("/dev/superusers/view");

  }



  return(

    <div className="form-page">

      <div className="form-card">

        <h1>Create Superuser</h1>

        <form
          onSubmit={handleSubmit}
          className="form-grid"
          autoComplete="off"
        >

          <div className="form-group">

            <label>First Name</label>

            <input
              type="text"
              value={firstName}
              onChange={(e)=>setFirstName(e.target.value)}
              autoComplete="off"
              name="first_name_new"
              required
            />

          </div>



          <div className="form-group">

            <label>Last Name</label>

            <input
              type="text"
              value={lastName}
              onChange={(e)=>setLastName(e.target.value)}
              autoComplete="off"
              name="last_name_new"
              required
            />

          </div>



          <div className="form-group">

            <label>Email</label>

            <input
              type="email"
              value={email}
              onChange={(e)=>setEmail(e.target.value)}
              autoComplete="off"
              name="email_new"
              required
            />

          </div>



          <div className="form-group">

            <label>Password</label>

            <input
              type="password"
              value={password}
              onChange={(e)=>setPassword(e.target.value)}
              autoComplete="new-password"
              name="password_new"
              required
            />

          </div>



          {error && (
            <div className="form-error">
              {error}
            </div>
          )}



          <div className="form-actions">

            <button
              type="submit"
              className="btn-primary"
              disabled={loading}
            >
              {loading ? "Creating..." : "Submit"}
            </button>



            <button
              type="button"
              className="btn-secondary"
              onClick={()=>router.push("/dev/superusers/view")}
            >
              Cancel
            </button>

          </div>

        </form>

      </div>

    </div>

  );

}