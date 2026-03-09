"use client";

import { useEffect,useState } from "react";
import { useRouter,useParams } from "next/navigation";

import { supabase } from "@/supabase/client";
import { auditLog } from "@/lib/audit/auditLogger";

import "@/styles/forms.css";
import "@/styles/buttons.css";

export default function EditSuperuserPage(){

  const router = useRouter();
  const params = useParams();

  const id = params.id as string;

  const [email,setEmail] = useState("");
  const [firstName,setFirstName] = useState("");
  const [lastName,setLastName] = useState("");
  const [password,setPassword] = useState("");
  const [frozen,setFrozen] = useState(false);

  const [deleteReason,setDeleteReason] = useState("");

  useEffect(()=>{

    const loadUser = async()=>{

      const { data } =
        await supabase
          .from("superusers")
          .select("*")
          .eq("id",id)
          .single();

      if(data){

        setEmail(data.email ?? "");
        setFirstName(data.first_name ?? "");
        setLastName(data.last_name ?? "");
        setFrozen(data.frozen ?? false);

        /* force password blank */
        setPassword("");

      }

    };

    loadUser();

  },[id]);

  const saveChanges = async()=>{

    const { data:userData } =
      await supabase.auth.getUser();

    const currentUser = userData?.user;

    const updateData:any = {

      email,
      first_name:firstName,
      last_name:lastName,
      frozen

    };

    if(password.trim() !== ""){
      updateData.password = password;
    }

    await supabase
      .from("superusers")
      .update(updateData)
      .eq("id",id);

    await auditLog({
      userId:currentUser?.id ?? null,
      action:"update_superuser",
      description:`Updated superuser ${email}`
    });

  };

  const deleteUser = async()=>{

    const { data:userData } =
      await supabase.auth.getUser();

    const currentUser = userData?.user;

    await supabase
      .from("superusers")
      .update({
        deleted_at:new Date(),
        deleted_by:currentUser?.id,
        delete_reason:deleteReason
      })
      .eq("id",id);

    await auditLog({
      userId:currentUser?.id ?? null,
      action:"delete_superuser",
      description:`Deleted superuser ${email}`
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

      <h1>Edit Superuser</h1>

      <form
        className="form-container"
        autoComplete="off"
      >

        <div className="form-group">

          <label>Email</label>

          <input
            className="form-input"
            autoComplete="off"
            value={email}
            onChange={(e)=>setEmail(e.target.value)}
          />

        </div>

        <div className="form-group">

          <label>First Name</label>

          <input
            className="form-input"
            autoComplete="off"
            value={firstName}
            onChange={(e)=>setFirstName(e.target.value)}
          />

        </div>

        <div className="form-group">

          <label>Last Name</label>

          <input
            className="form-input"
            autoComplete="off"
            value={lastName}
            onChange={(e)=>setLastName(e.target.value)}
          />

        </div>

        <div className="form-group">

          <label>Password</label>

          <input
            type="password"
            name="new-password"
            autoComplete="new-password"
            className="form-input"
            placeholder="Only enter if changing password"
            value={password}
            onChange={(e)=>setPassword(e.target.value)}
          />

          <small className="form-help">
            Leave blank unless changing password
          </small>

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
          type="button"
          onClick={saveChanges}
        >
          Save Changes
        </button>

        <hr/>

        <h3>Delete Superuser</h3>

        <div className="form-group">

          <label>Delete Reason</label>

          <input
            className="form-input"
            value={deleteReason}
            onChange={(e)=>setDeleteReason(e.target.value)}
          />

        </div>

        <button
          className="btn-danger"
          type="button"
          onClick={deleteUser}
        >
          Delete Superuser
        </button>

      </form>

    </div>

  );

}