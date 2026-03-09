"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { supabase } from "@/supabase/client";
import { auditLog } from "@/lib/audit/auditLogger";

import "@/styles/forms.css";
import "@/styles/button.css";

export default function CreateSuperuserPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();

    const { data: session } = await supabase.auth.getUser();
    const currentUser = session?.user;

    const { error } = await supabase.from("superusers").insert([
      {
        name,
        email,
        frozen: false,
      },
    ]);

    if (!error) {
      await auditLog({
        userId: currentUser?.id ?? null,
        action: "create_superuser",
        description: `Created superuser ${email}`,
      });

      router.push("/dev/superusers/view");
    }
  };

  return (
    <div>
      <button className="btn-secondary" onClick={() => router.back()}>
        Back
      </button>

      <h1>Create Superuser</h1>

      <form className="form-container" onSubmit={handleCreate}>
        <input
          className="form-input"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />

        <input
          className="form-input"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <button className="btn-primary" type="submit">
          Create Superuser
        </button>
      </form>
    </div>
  );
}