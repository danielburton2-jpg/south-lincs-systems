"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function CreateSuperuser() {

  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const handleCreate = async (e: React.FormEvent) => {

    e.preventDefault();

    console.log("Create superuser:", name, email);

  };

  return (

    <div>

      <button onClick={() => router.back()}>
        Back
      </button>

      <h1>Create Superuser</h1>

      <form onSubmit={handleCreate}>

        <input
          placeholder="Name"
          value={name}
          onChange={(e)=>setName(e.target.value)}
        />

        <input
          placeholder="Email"
          value={email}
          onChange={(e)=>setEmail(e.target.value)}
        />

        <button type="submit">
          Create
        </button>

      </form>

    </div>

  );

}