"use client";

import { useRouter, useParams } from "next/navigation";
import { supabase } from "@/supabase/client";
import { auditLog } from "@/lib/audit/auditLogger";

import "@/styles/button.css";

export default function EditSuperuserPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id;

  const freezeUser = async () => {
    await supabase.from("superusers").update({ frozen: true }).eq("id", id);

    const { data } = await supabase.auth.getUser();

    await auditLog({
      userId: data.user?.id ?? null,
      action: "freeze_superuser",
      description: `Froze superuser ${id}`,
    });
  };

  const unfreezeUser = async () => {
    await supabase.from("superusers").update({ frozen: false }).eq("id", id);

    const { data } = await supabase.auth.getUser();

    await auditLog({
      userId: data.user?.id ?? null,
      action: "unfreeze_superuser",
      description: `Unfroze superuser ${id}`,
    });
  };

  const deleteUser = async () => {
    await supabase.from("superusers").delete().eq("id", id);

    const { data } = await supabase.auth.getUser();

    await auditLog({
      userId: data.user?.id ?? null,
      action: "delete_superuser",
      description: `Deleted superuser ${id}`,
    });

    router.push("/dev/superusers/view");
  };

  return (
    <div>
      <button className="btn-secondary" onClick={() => router.back()}>
        Back
      </button>

      <h1>Edit Superuser</h1>

      <button className="btn-warning" onClick={freezeUser}>
        Freeze
      </button>

      <button className="btn-primary" onClick={unfreezeUser}>
        Unfreeze
      </button>

      <button className="btn-danger" onClick={deleteUser}>
        Delete
      </button>
    </div>
  );
}